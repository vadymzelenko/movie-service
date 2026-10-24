'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { titleKey, type ListEntry, type ListName, type ProgressEntry, type TitleSummary } from '@movie/shared';
import { api } from './api';
import { flushDirtyPlayback } from './playback-store';

interface LibraryState {
  progress: Map<string, ProgressEntry>;
  lists: ListEntry[];
  hideWatched: boolean;
  setHideWatched: (v: boolean) => void;
  isWatched: (t: Pick<TitleSummary, 'kind' | 'id'>) => boolean;
  /** Прогресс фильма (для сериала — последняя начатая серия). */
  progressOf: (t: Pick<TitleSummary, 'kind' | 'id'>) => ProgressEntry | undefined;
  inList: (list: ListName, t: Pick<TitleSummary, 'kind' | 'id'>) => boolean;
  toggleList: (list: ListName, t: TitleSummary) => Promise<void>;
  setWatched: (key: string, watched: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  /** Отфильтровать каталог по переключателю «Скрыть просмотренные». */
  visible: <T extends Pick<TitleSummary, 'kind' | 'id'>>(items: T[]) => T[];
}

const Ctx = createContext<LibraryState | null>(null);
const HIDE_KEY = 'hide-watched';

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<Map<string, ProgressEntry>>(new Map());
  const [lists, setLists] = useState<ListEntry[]>([]);
  const [hideWatched, setHide] = useState(false);

  const refresh = useCallback(async () => {
    const [p, l] = await Promise.all([api.progress().catch(() => []), api.lists().catch(() => [])]);
    setProgress(new Map(p.map((e) => [e.mediaKey, e])));
    setLists(l);
  }, []);

  useEffect(() => {
    // Сначала досылаем таймкоды, записанные офлайн, затем читаем историю с сервера.
    void flushDirtyPlayback().finally(() => void refresh());
    const onOnline = () =>
      void flushDirtyPlayback().then((n) => {
        if (n > 0) void refresh();
      });
    window.addEventListener('online', onOnline);
    try {
      setHide(localStorage.getItem(HIDE_KEY) === '1');
    } catch {
      /* storage недоступен */
    }
    return () => window.removeEventListener('online', onOnline);
  }, [refresh]);

  const setHideWatched = useCallback((v: boolean) => {
    setHide(v);
    try {
      localStorage.setItem(HIDE_KEY, v ? '1' : '0');
    } catch {
      /* storage недоступен */
    }
  }, []);

  const value = useMemo<LibraryState>(() => {
    // Последняя активность по каждому тайтлу (для сериала — по любой серии).
    const latestByTitle = new Map<string, ProgressEntry>();
    for (const e of progress.values()) {
      const k = titleKey(e);
      const prev = latestByTitle.get(k);
      if (!prev || prev.updatedAt < e.updatedAt) latestByTitle.set(k, e);
    }
    // Сериал считается просмотренным только по явной отметке всего тайтла (ключ `tv:<id>`).
    const isWatched = (t: Pick<TitleSummary, 'kind' | 'id'>) => progress.get(titleKey(t))?.watched === true;
    return {
      progress,
      lists,
      hideWatched,
      setHideWatched,
      isWatched,
      progressOf: (t) => (t.kind === 'movie' ? progress.get(titleKey(t)) : latestByTitle.get(titleKey(t))),
      inList: (list, t) => lists.some((e) => e.list === list && e.kind === t.kind && e.id === t.id),
      toggleList: async (list, t) => {
        const has = lists.some((e) => e.list === list && e.kind === t.kind && e.id === t.id);
        if (has) await api.removeFromList(list, t.kind, t.id);
        else await api.addToList(list, t);
        await refresh();
      },
      setWatched: async (key, watched) => {
        const prev = progress.get(key);
        await api.saveProgress(key, { position: watched ? (prev?.position ?? 0) : 0, duration: prev?.duration ?? 0, watched });
        await refresh();
      },
      refresh,
      visible: (items) => (hideWatched ? items.filter((i) => !isWatched(i)) : items),
    };
  }, [progress, lists, hideWatched, setHideWatched, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary(): LibraryState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary: нет LibraryProvider');
  return v;
}
