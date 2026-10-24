import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH, type PeerInfo, type TvState } from '@movie/shared';

export interface Room {
  id: string;
  /** Секрет TV: позволяет вернуться в комнату после реконнекта. В QR не попадает. */
  tvToken: string;
  tvSocketId: string | null;
  remotes: Map<string, PeerInfo>;
  /** Последнее состояние TV — отдаётся новому пульту сразу при подключении. */
  lastTvState: TvState | null;
  createdAt: number;
  closeTimer: NodeJS.Timeout | null;
}

export function generateRoomId(): string {
  let id = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) id += ROOM_ID_ALPHABET[randomInt(ROOM_ID_ALPHABET.length)];
  return id;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Хранилище комнат в памяти процесса. Для одного дома этого достаточно;
 * при горизонтальном масштабировании заменяется на Redis + @socket.io/redis-adapter.
 */
export class RoomRegistry {
  private rooms = new Map<string, Room>();

  constructor(
    private readonly graceMs: number,
    private readonly onExpire: (room: Room) => void,
  ) {}

  create(tvSocketId: string): Room {
    let id = generateRoomId();
    while (this.rooms.has(id)) id = generateRoomId();
    const room: Room = {
      id,
      tvToken: randomBytes(24).toString('base64url'),
      tvSocketId,
      remotes: new Map(),
      lastTvState: null,
      createdAt: Date.now(),
      closeTimer: null,
    };
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** TV возвращается в комнату. Возвращает null, если токен неверный или комната истекла. */
  resume(id: string, tvToken: string, tvSocketId: string): Room | null {
    const room = this.rooms.get(id);
    if (!room || !safeEqual(room.tvToken, tvToken)) return null;
    if (room.closeTimer) clearTimeout(room.closeTimer);
    room.closeTimer = null;
    room.tvSocketId = tvSocketId;
    return room;
  }

  addRemote(id: string, peer: PeerInfo): Room | null {
    const room = this.rooms.get(id);
    if (!room) return null;
    room.remotes.set(peer.socketId, peer);
    return room;
  }

  removeRemote(id: string, socketId: string): Room | null {
    const room = this.rooms.get(id);
    if (!room) return null;
    room.remotes.delete(socketId);
    return room;
  }

  /** TV отвалился: даём grace-период на реконнект, затем закрываем комнату. */
  tvDisconnected(id: string, socketId: string): Room | null {
    const room = this.rooms.get(id);
    if (!room || room.tvSocketId !== socketId) return null;
    room.tvSocketId = null;
    room.closeTimer = setTimeout(() => {
      this.rooms.delete(id);
      this.onExpire(room);
    }, this.graceMs);
    room.closeTimer.unref();
    return room;
  }

  size(): number {
    return this.rooms.size;
  }

  dispose(): void {
    for (const room of this.rooms.values()) if (room.closeTimer) clearTimeout(room.closeTimer);
    this.rooms.clear();
  }
}
