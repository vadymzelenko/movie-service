'use client';

import { useCallback, useEffect, useRef } from 'react';
import { mediaKey, type MediaRef } from '@movie/shared';
import { api } from '@/lib/api';
import { flushDirtyPlayback, markClean, readLocal, writeLocal } from '@/lib/playback-store';

const LOCAL_EVERY_MS = 5_000;
const SERVER_EVERY_MS = 10_000;

/**
 * Dual-Sync таймкодов: localStorage (мгновенно, каждые 5 с) + SQLite-бэкенд (батчем раз в 10 с
 * и обязательно на pause / ended / seeked / уходе со страницы / выходе из плеера).
 * Пока сервер не подтвердил запись, локальная копия помечена `dirty` и досылается
 * при восстановлении сети (`online`) или следующем запуске.
 *
 * Возвращает `flush()` — дождаться записи (используется при выходе из плеера).
 */
export function usePlaybackSync(video: HTMLVideoElement | null, media: MediaRef) {
  const key = mediaKey(media);
  const lastLocalAt = useRef(0);
  const lastSent = useRef<{ position: number; updatedAt: number } | null>(null);

  const snapshot = useCallback(() => {
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return null;
    const position = video.ended ? video.duration : video.currentTime;
    return position > 0 ? { position, duration: video.duration } : null;
  }, [video]);

  /** Мгновенная локальная запись. */
  const saveLocal = useCallback(() => {
    const s = snapshot();
    if (!s) return null;
    const entry = { ...s, updatedAt: Date.now(), dirty: true };
    writeLocal(key, entry);
    lastLocalAt.current = entry.updatedAt;
    return entry;
  }, [key, snapshot]);

  /** Отправка на сервер; при ошибке запись остаётся dirty. */
  const flush = useCallback(async () => {
    const entry = saveLocal() ?? readLocal(key);
    if (!entry?.dirty) return;
    if (lastSent.current && Math.abs(lastSent.current.position - entry.position) < 0.5) {
      markClean(key, entry.updatedAt);
      return;
    }
    try {
      await api.saveProgress(key, { position: entry.position, duration: entry.duration });
      lastSent.current = { position: entry.position, updatedAt: entry.updatedAt };
      markClean(key, entry.updatedAt);
    } catch {
      /* офлайн / сервер недоступен: остаётся dirty, досинхронизируем позже */
    }
  }, [key, saveLocal]);

  useEffect(() => {
    if (!video) return;
    const onTime = () => {
      if (Date.now() - lastLocalAt.current >= LOCAL_EVERY_MS) saveLocal();
    };
    const onImportant = () => void flush();
    const timer = setInterval(() => {
      if (!video.paused) void flush();
    }, SERVER_EVERY_MS);
    // Закрытие вкладки/выключение TV: fetch не успеет — beacon. Успех неизвестен, поэтому dirty остаётся.
    const onLeave = () => {
      const entry = saveLocal();
      if (entry && document.visibilityState !== 'visible') api.beaconProgress(media, { position: entry.position, duration: entry.duration });
    };
    const onUnload = () => {
      const entry = saveLocal();
      if (entry) api.beaconProgress(media, { position: entry.position, duration: entry.duration });
    };
    const onOnline = () => void flushDirtyPlayback();

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('pause', onImportant);
    video.addEventListener('ended', onImportant);
    video.addEventListener('seeked', onImportant);
    document.addEventListener('visibilitychange', onLeave);
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(timer);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('pause', onImportant);
      video.removeEventListener('ended', onImportant);
      video.removeEventListener('seeked', onImportant);
      document.removeEventListener('visibilitychange', onLeave);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('online', onOnline);
      // Плеер закрыт/переключён: финальная позиция локально + попытка отправить.
      void flush();
    };
  }, [video, media, saveLocal, flush]);

  return { flush };
}
