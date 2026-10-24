import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { z } from 'zod';
import {
  castMediaSchema,
  pairSchema,
  playerControlSchema,
  pointerMoveSchema,
  pointerScrollSchema,
  remoteKeyEventSchema,
  resumeRoomSchema,
  textInputSchema,
  tvStateSchema,
  type ClientToServerEvents,
  type PeerInfo,
  type ServerToClientEvents,
  type SocketData,
} from '@movie/shared';
import { RoomRegistry, type Room } from './rooms.js';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type AppIo = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Простой token bucket: защищает TV от «залипших» пультов и флуда. */
class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

const tvRoom = (roomId: string) => `room:${roomId}:tv`;
const remotesRoom = (roomId: string) => `room:${roomId}:remotes`;

export interface SocketServerOptions {
  corsOrigins: string[];
  roomGraceMs: number;
}

export function createSocketServer(httpServer: HttpServer, opts: SocketServerOptions) {
  const io: AppIo = new Server(httpServer, {
    cors: { origin: opts.corsOrigins.length ? opts.corsOrigins : true },
    // Пульт управления должен реагировать мгновенно: только WebSocket, без long-polling-а на старте.
    transports: ['websocket'],
    pingInterval: 10_000,
    pingTimeout: 8_000,
    connectionStateRecovery: { maxDisconnectionDuration: 30_000 },
  });

  const rooms = new RoomRegistry(opts.roomGraceMs, (room) => {
    io.to(remotesRoom(room.id)).emit('room:closed');
    io.socketsLeave(remotesRoom(room.id));
  });

  const peersOf = (room: Room): PeerInfo[] => [...room.remotes.values()];

  const broadcastPeers = (room: Room) => {
    const peers = peersOf(room);
    io.to(tvRoom(room.id)).emit('room:peers', peers);
    io.to(remotesRoom(room.id)).emit('room:peers', peers);
  };

  io.on('connection', (socket: AppSocket) => {
    socket.data.role = null;
    socket.data.roomId = null;
    socket.data.deviceName = 'Устройство';

    // Отдельные лимиты: движения тачпада идут потоком (~60/с), остальное — редко.
    const pointerBucket = new TokenBucket(120, 90);
    const commandBucket = new TokenBucket(30, 20);

    // ---- TV -------------------------------------------------------------

    socket.on('room:create', (ack) => {
      if (typeof ack !== 'function') return;
      leaveCurrent(socket);
      const room = rooms.create(socket.id);
      socket.data.role = 'tv';
      socket.data.roomId = room.id;
      void socket.join(tvRoom(room.id));
      ack({ ok: true, roomId: room.id, tvToken: room.tvToken });
    });

    socket.on('room:resume', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const parsed = resumeRoomSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: 'invalid_payload' });
      const room = rooms.resume(parsed.data.roomId, parsed.data.tvToken, socket.id);
      if (!room) return ack({ ok: false, error: 'room_not_found' });
      socket.data.role = 'tv';
      socket.data.roomId = room.id;
      void socket.join(tvRoom(room.id));
      io.to(remotesRoom(room.id)).emit('room:tv_presence', { online: true });
      socket.emit('room:peers', peersOf(room));
      ack({ ok: true, roomId: room.id });
    });

    socket.on('tv_state', (payload) => {
      const room = currentRoom(socket, 'tv');
      if (!room) return;
      const parsed = tvStateSchema.safeParse(payload);
      if (!parsed.success) return;
      room.lastTvState = parsed.data;
      socket.to(remotesRoom(room.id)).volatile.emit('tv_state', parsed.data);
    });

    // ---- Пульт ----------------------------------------------------------

    socket.on('pair', (payload, ack) => {
      if (typeof ack !== 'function') return;
      if (!commandBucket.take()) return ack({ ok: false, error: 'rate_limited' });
      const parsed = pairSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: 'invalid_payload' });
      leaveCurrent(socket);
      const deviceName = parsed.data.deviceName?.trim() || 'Телефон';
      const room = rooms.addRemote(parsed.data.roomId, {
        socketId: socket.id,
        deviceName,
        connectedAt: Date.now(),
      });
      if (!room) return ack({ ok: false, error: 'room_not_found' });
      socket.data.role = 'remote';
      socket.data.roomId = room.id;
      socket.data.deviceName = deviceName;
      void socket.join(remotesRoom(room.id));
      ack({ ok: true, roomId: room.id, tvState: room.lastTvState });
      broadcastPeers(room);
    });

    /** Ретрансляция «пульт → TV» с валидацией. */
    const relay = <S extends z.ZodType>(
      bucket: TokenBucket,
      schema: S,
      send: (target: ReturnType<AppIo['to']>, data: z.output<S>) => void,
    ) => {
      return (payload: unknown) => {
        const room = currentRoom(socket, 'remote');
        if (!room || !bucket.take()) return;
        const parsed = schema.safeParse(payload);
        if (!parsed.success) return;
        send(io.to(tvRoom(room.id)), parsed.data);
      };
    };

    socket.on('remote_key', relay(commandBucket, remoteKeyEventSchema, (t, d) => t.emit('remote_key', d)));
    socket.on('text_input', relay(commandBucket, textInputSchema, (t, d) => t.emit('text_input', d)));
    socket.on('player_control', relay(commandBucket, playerControlSchema, (t, d) => t.emit('player_control', d)));
    socket.on('cast_media', relay(commandBucket, castMediaSchema, (t, d) => t.emit('cast_media', d)));
    // Движения курсора — volatile: потерянный кадр лучше, чем очередь устаревших дельт.
    socket.on('pointer_move', relay(pointerBucket, pointerMoveSchema, (t, d) => t.volatile.emit('pointer_move', d)));
    socket.on('pointer_scroll', relay(pointerBucket, pointerScrollSchema, (t, d) => t.volatile.emit('pointer_scroll', d)));
    socket.on('pointer_click', () => {
      const room = currentRoom(socket, 'remote');
      if (room && commandBucket.take()) io.to(tvRoom(room.id)).emit('pointer_click');
    });

    socket.on('disconnect', () => leaveCurrent(socket));
  });

  function currentRoom(socket: AppSocket, role: 'tv' | 'remote'): Room | null {
    if (socket.data.role !== role || !socket.data.roomId) return null;
    return rooms.get(socket.data.roomId) ?? null;
  }

  function leaveCurrent(socket: AppSocket) {
    const { roomId, role } = socket.data;
    if (!roomId || !role) return;
    if (role === 'tv') {
      void socket.leave(tvRoom(roomId));
      if (rooms.tvDisconnected(roomId, socket.id)) {
        io.to(remotesRoom(roomId)).emit('room:tv_presence', { online: false });
      }
    } else {
      void socket.leave(remotesRoom(roomId));
      const room = rooms.removeRemote(roomId, socket.id);
      if (room) broadcastPeers(room);
    }
    socket.data.role = null;
    socket.data.roomId = null;
  }

  return { io, rooms };
}
