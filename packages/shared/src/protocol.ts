import { z } from 'zod';
import { mediaRefSchema, type MediaRef } from './media.js';

/**
 * Протокол WebSocket-моста TV ↔ телефон (Socket.io).
 *
 * Топология: одна «комната» = один телевизор + N пультов.
 *  - TV создаёт комнату (`room:create`) и показывает QR с room_id.
 *  - Пульт присоединяется (`pair`) и шлёт команды; сервер ретранслирует их ТОЛЬКО на TV.
 *  - TV публикует `player_state` / `tv_state`; сервер рассылает их ТОЛЬКО пультам.
 */

export const ROOM_ID_LENGTH = 8;
export const ROOM_ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const roomIdSchema = z
  .string()
  .length(ROOM_ID_LENGTH)
  .regex(new RegExp(`^[${ROOM_ID_ALPHABET}]+$`));

export const remoteKeySchema = z.enum(['up', 'down', 'left', 'right', 'enter', 'back', 'home', 'play_pause']);
export type RemoteKey = z.infer<typeof remoteKeySchema>;

export const pairSchema = z.object({
  roomId: roomIdSchema,
  deviceName: z.string().max(64).optional(),
});
export type PairPayload = z.infer<typeof pairSchema>;

/** TV переподключается к своей комнате после обрыва сети / перезагрузки страницы. */
export const resumeRoomSchema = z.object({
  roomId: roomIdSchema,
  tvToken: z.string().min(16).max(128),
});
export type ResumeRoomPayload = z.infer<typeof resumeRoomSchema>;

export const remoteKeyEventSchema = z.object({ key: remoteKeySchema });
export type RemoteKeyEvent = z.infer<typeof remoteKeyEventSchema>;

export const pointerMoveSchema = z.object({
  dx: z.number().min(-500).max(500),
  dy: z.number().min(-500).max(500),
});
export type PointerMoveEvent = z.infer<typeof pointerMoveSchema>;

export const pointerScrollSchema = z.object({
  dy: z.number().min(-2000).max(2000),
});
export type PointerScrollEvent = z.infer<typeof pointerScrollSchema>;

export const textInputSchema = z.object({
  value: z.string().max(200),
  submit: z.boolean().optional(),
});
export type TextInputEvent = z.infer<typeof textInputSchema>;

export const playerControlSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('play') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('toggle') }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('seek_relative'), seconds: z.number().min(-3600).max(3600) }),
  z.object({ type: z.literal('seek_absolute'), seconds: z.number().min(0) }),
  z.object({ type: z.literal('volume'), value: z.number().min(0).max(1) }),
  z.object({ type: z.literal('mute'), muted: z.boolean() }),
]);
export type PlayerControl = z.infer<typeof playerControlSchema>;

export const castMediaSchema = z.object({
  media: mediaRefSchema,
  /** true — сразу запускать плеер; false — только открыть карточку тайтла. */
  autoplay: z.boolean().default(true),
  /** Секунда старта; не задано — продолжить с сохранённого таймкода. */
  startAt: z.number().min(0).optional(),
});
export type CastMediaEvent = z.input<typeof castMediaSchema>;

export interface PlayerState {
  media: MediaRef;
  title: string;
  subtitle?: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  buffering: boolean;
  volume: number;
  muted: boolean;
}

export const playerStateSchema = z.object({
  media: mediaRefSchema,
  title: z.string().max(300),
  subtitle: z.string().max(300).optional(),
  currentTime: z.number().min(0),
  duration: z.number().min(0),
  paused: z.boolean(),
  buffering: z.boolean(),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
});

/** Сводка состояния экрана TV, чтобы пульт мог подстроить интерфейс. */
export const tvStateSchema = z.object({
  screen: z.enum(['browse', 'details', 'player']),
  searchQuery: z.string().max(200),
  player: playerStateSchema.nullable(),
});
export type TvState = z.infer<typeof tvStateSchema>;

export interface PeerInfo {
  socketId: string;
  deviceName: string;
  connectedAt: number;
}

export type Ack<T> =
  | ({ ok: true } & T)
  | { ok: false; error: 'invalid_payload' | 'room_not_found' | 'forbidden' | 'rate_limited' };

export type AckFn<T> = (res: Ack<T>) => void;

export interface ClientToServerEvents {
  /** TV: создать новую комнату. */
  'room:create': (ack: AckFn<{ roomId: string; tvToken: string }>) => void;
  /** TV: вернуться в существующую комнату (после реконнекта). */
  'room:resume': (payload: ResumeRoomPayload, ack: AckFn<{ roomId: string }>) => void;
  /** Пульт: подключиться к комнате по QR. */
  pair: (payload: PairPayload, ack: AckFn<{ roomId: string; tvState: TvState | null }>) => void;

  // Пульт → TV
  remote_key: (payload: RemoteKeyEvent) => void;
  pointer_move: (payload: PointerMoveEvent) => void;
  pointer_click: () => void;
  pointer_scroll: (payload: PointerScrollEvent) => void;
  text_input: (payload: TextInputEvent) => void;
  player_control: (payload: PlayerControl) => void;
  cast_media: (payload: CastMediaEvent) => void;

  // TV → пульты
  tv_state: (payload: TvState) => void;
}

export interface ServerToClientEvents {
  remote_key: (payload: RemoteKeyEvent) => void;
  pointer_move: (payload: PointerMoveEvent) => void;
  pointer_click: () => void;
  pointer_scroll: (payload: PointerScrollEvent) => void;
  text_input: (payload: TextInputEvent) => void;
  player_control: (payload: PlayerControl) => void;
  cast_media: (payload: z.output<typeof castMediaSchema>) => void;

  tv_state: (payload: TvState) => void;
  'room:peers': (peers: PeerInfo[]) => void;
  /** Телевизор отключился и не вернулся за grace-период. */
  'room:closed': () => void;
  /** Телевизор временно offline (идёт реконнект). */
  'room:tv_presence': (payload: { online: boolean }) => void;
}

export interface SocketData {
  role: 'tv' | 'remote' | null;
  roomId: string | null;
  deviceName: string;
}
