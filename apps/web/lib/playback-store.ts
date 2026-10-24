import { WATCHED_THRESHOLD, type ProgressEntry } from '@movie/shared';
import { api } from './api';

/**
 * Локальная копия таймкодов (localStorage). Пишется мгновенно и не зависит от сети;
 * `dirty: true` — сервер эту позицию ещё не подтвердил, её нужно досинхронизировать.
 */
export interface LocalPlayback {
  position: number;
  duration: number;
  updatedAt: number;
  dirty: boolean;
}

const PREFIX = 'pb:';
const MAX_ENTRIES = 300;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readLocal(key: string): LocalPlayback | null {
  try {
    const raw = storage()?.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as LocalPlayback) : null;
  } catch {
    return null;
  }
}

export function writeLocal(key: string, entry: LocalPlayback): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Квота: выкидываем самые старые подтверждённые записи и пробуем ещё раз.
    prune(s);
    try {
      s.setItem(PREFIX + key, JSON.stringify(entry));
    } catch {
      /* storage недоступен — остаётся только сервер */
    }
  }
}

function entries(s: Storage): [string, LocalPlayback][] {
  const out: [string, LocalPlayback][] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k?.startsWith(PREFIX)) continue;
    const v = readLocal(k.slice(PREFIX.length));
    if (v) out.push([k.slice(PREFIX.length), v]);
  }
  return out;
}

function prune(s: Storage) {
  const clean = entries(s)
    .filter(([, v]) => !v.dirty)
    .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const excess = Math.max(clean.length - MAX_ENTRIES / 2, Math.ceil(clean.length / 4));
  for (const [k] of clean.slice(0, excess)) s.removeItem(PREFIX + k);
}

export function markClean(key: string, updatedAt: number): void {
  const cur = readLocal(key);
  // Пока шёл запрос, могла записаться более свежая позиция — её не трогаем.
  if (cur && cur.updatedAt === updatedAt) writeLocal(key, { ...cur, dirty: false });
}

/**
 * Позиция для «Смотреть с MM:SS»: свежайшая из сервера и локальной копии
 * (если смотрели офлайн, локальная новее).
 */
export function resumePosition(key: string, server: ProgressEntry | undefined): number {
  const local = readLocal(key);
  const useLocal = local && (!server || local.updatedAt > server.updatedAt);
  const pos = useLocal ? local.position : (server?.position ?? 0);
  const dur = useLocal ? local.duration : (server?.duration ?? 0);
  const watched = useLocal ? dur > 0 && pos / dur >= WATCHED_THRESHOLD : server?.watched;
  return !watched && pos > 30 ? pos : 0;
}

let flushing: Promise<number> | null = null;

/** Досылает на сервер все неподтверждённые позиции. Возвращает число синхронизированных. */
export function flushDirtyPlayback(): Promise<number> {
  const s = storage();
  if (!s) return Promise.resolve(0);
  flushing ??= (async () => {
    const dirty = entries(s).filter(([, v]) => v.dirty);
    if (!dirty.length) return 0;
    // Не перетираем более свежий прогресс, записанный с другого устройства.
    const server = new Map((await api.progress()).map((p) => [p.mediaKey, p]));
    let synced = 0;
    for (const [key, v] of dirty) {
      const remote = server.get(key);
      if (remote && remote.updatedAt >= v.updatedAt) {
        markClean(key, v.updatedAt);
        continue;
      }
      await api.saveProgress(key, { position: v.position, duration: v.duration });
      markClean(key, v.updatedAt);
      synced++;
    }
    return synced;
  })().finally(() => (flushing = null));
  return flushing.catch(() => 0);
}
