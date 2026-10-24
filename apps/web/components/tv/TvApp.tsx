'use client';

import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogQuery, CatalogSort, Genre, MediaKind, PlayerState, TitleSummary, TvState } from '@movie/shared';
import { api } from '@/lib/api';
import { LibraryProvider, useLibrary } from '@/lib/library-store';
import { playerBus } from '@/lib/player-bus';
import { FocusSection, SpatialNavigationProvider, useBackHandler, useSpatialEngine } from '@/lib/spatial/SpatialNavigation';
import { useTvRoom } from '@/lib/use-tv-room';
import { FocusButton } from './FocusButton';
import { Header, type Tab } from './Header';
import { Hero } from './Hero';
import { MediaRow } from './MediaRow';
import { PairingBadge } from './PairingBadge';
import { PosterGrid } from './PosterGrid';
import { TitleModal, type OpenRequest } from './TitleModal';
import { VirtualCursor } from './VirtualCursor';

/** Весь интерфейс свёрстан в rem под 1920×1080; масштабируем под фактическое разрешение браузера TV. */
function useTvScale() {
  useEffect(() => {
    const html = document.documentElement;
    const apply = () => {
      html.style.fontSize = `${Math.max(8, (window.innerWidth / 1920) * 16)}px`;
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      html.style.fontSize = '';
    };
  }, []);
}

/** Пагинированная выдача каталога. */
function useCatalog(query: Partial<CatalogQuery> | null) {
  const [items, setItems] = useState<TitleSummary[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const loading = useRef(false);
  const key = JSON.stringify(query);

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    setItems([]);
    setPage(1);
    loading.current = true;
    void api
      .catalog({ ...query, page: 1 })
      .then((r) => {
        if (cancelled) return;
        setItems(r.results);
        setTotalPages(r.totalPages);
      })
      .catch(() => {})
      .finally(() => (loading.current = false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadMore = useCallback(() => {
    if (!query || loading.current || page >= totalPages) return;
    loading.current = true;
    const next = page + 1;
    void api
      .catalog({ ...query, page: next })
      .then((r) => {
        setItems((prev) => {
          const seen = new Set(prev.map((p) => `${p.kind}:${p.id}`));
          return [...prev, ...r.results.filter((x) => !seen.has(`${x.kind}:${x.id}`))];
        });
        setPage(next);
      })
      .catch(() => {})
      .finally(() => (loading.current = false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page, totalPages]);

  return { items, loadMore };
}

function CatalogRow({ id, title, query, onOpen }: { id: string; title: string; query: Partial<CatalogQuery>; onOpen: (t: TitleSummary) => void }) {
  const lib = useLibrary();
  const { items, loadMore } = useCatalog(query);
  return <MediaRow id={id} title={title} items={lib.visible(items)} onOpen={onOpen} onNearEnd={loadMore} />;
}

/** «Продолжить просмотр»: начатые и не досмотренные тайтлы. */
function ContinueRow({ onOpen }: { onOpen: (t: TitleSummary) => void }) {
  const lib = useLibrary();
  const [items, setItems] = useState<TitleSummary[]>([]);
  const keys = useMemo(() => {
    const seen = new Set<string>();
    const out: { kind: MediaKind; id: number }[] = [];
    for (const e of [...lib.progress.values()].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const k = `${e.kind}:${e.id}`;
      if (seen.has(k) || e.watched || e.position < 30) continue;
      seen.add(k);
      out.push({ kind: e.kind, id: e.id });
    }
    return out.slice(0, 12);
  }, [lib.progress]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(keys.map((k) => api.title(k.kind, k.id).catch(() => null))).then((r) => {
      if (!cancelled) setItems(r.filter((x): x is NonNullable<typeof x> => x !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [keys]);

  return <MediaRow id="row:continue" title="Продолжить просмотр" items={items} onOpen={onOpen} />;
}

function HomeView({ onOpen, onPlay }: { onOpen: (t: TitleSummary) => void; onPlay: (t: TitleSummary) => void }) {
  const lib = useLibrary();
  const { items: featured } = useCatalog({ kind: 'movie', sort: 'popular' });
  const hero = lib.visible(featured).find((f) => f.backdropUrl) ?? lib.visible(featured)[0];
  return (
    <>
      <Hero item={hero} onOpen={onOpen} onPlay={onPlay} />
      <div className="space-y-6 pt-4">
        <ContinueRow onOpen={onOpen} />
        <CatalogRow id="row:movie-new" title="Новинки кино" query={{ kind: 'movie', sort: 'new' }} onOpen={onOpen} />
        <CatalogRow id="row:movie-popular" title="Популярные фильмы" query={{ kind: 'movie', sort: 'popular' }} onOpen={onOpen} />
        <CatalogRow id="row:movie-top" title="Лучшие по рейтингу" query={{ kind: 'movie', sort: 'rating' }} onOpen={onOpen} />
        <CatalogRow id="row:tv-popular" title="Популярные сериалы" query={{ kind: 'tv', sort: 'popular' }} onOpen={onOpen} />
        <CatalogRow id="row:tv-top" title="Лучшие сериалы" query={{ kind: 'tv', sort: 'rating' }} onOpen={onOpen} />
      </div>
    </>
  );
}

const SORTS: { id: CatalogSort; label: string }[] = [
  { id: 'popular', label: 'Популярные' },
  { id: 'rating', label: 'По рейтингу' },
  { id: 'new', label: 'Новинки' },
];

function CatalogView({ kind, onOpen }: { kind: MediaKind; onOpen: (t: TitleSummary) => void }) {
  const lib = useLibrary();
  const [sort, setSort] = useState<CatalogSort>('popular');
  const [genre, setGenre] = useState<number | undefined>();
  const [genres, setGenres] = useState<Genre[]>([]);
  const { items, loadMore } = useCatalog({ kind, sort, genre });

  useEffect(() => {
    setGenre(undefined);
    void api.genres(kind).then(setGenres).catch(() => setGenres([]));
  }, [kind]);

  return (
    <div className="space-y-6 pt-4">
      <FocusSection id={`filters:sort:${kind}`} remember className="flex gap-3 px-[5rem]">
        {SORTS.map((s) => (
          <FocusButton key={s.id} variant="chip" selected={sort === s.id} onEnter={() => setSort(s.id)}>
            {s.label}
          </FocusButton>
        ))}
      </FocusSection>
      <FocusSection id={`filters:genre:${kind}`} remember className="no-scrollbar flex gap-3 overflow-x-auto px-[5rem] py-2">
        <FocusButton variant="chip" selected={genre === undefined} onEnter={() => setGenre(undefined)}>
          Все жанры
        </FocusButton>
        {genres.map((g) => (
          <FocusButton key={g.id} variant="chip" selected={genre === g.id} onEnter={() => setGenre(g.id)}>
            {g.name}
          </FocusButton>
        ))}
      </FocusSection>
      <PosterGrid id={`grid:${kind}`} items={lib.visible(items)} onOpen={onOpen} onNearEnd={loadMore} />
    </div>
  );
}

function ListsView({ onOpen }: { onOpen: (t: TitleSummary) => void }) {
  const lib = useLibrary();
  const fav = lib.visible(lib.lists.filter((l) => l.list === 'favorite').map((l) => l.snapshot));
  const later = lib.visible(lib.lists.filter((l) => l.list === 'watch_later').map((l) => l.snapshot));
  if (!fav.length && !later.length) {
    return <p className="px-[5rem] py-16 text-[1.8rem] text-muted">Добавляйте фильмы в «Избранное» и «Посмотреть позже» из карточки тайтла.</p>;
  }
  return (
    <div className="space-y-6 pt-6">
      <MediaRow id="row:fav" title="Избранное" items={fav} onOpen={onOpen} />
      <MediaRow id="row:later" title="Посмотреть позже" items={later} onOpen={onOpen} />
    </div>
  );
}

function SearchView({ query, onOpen }: { query: string; onOpen: (t: TitleSummary) => void }) {
  const lib = useLibrary();
  const [results, setResults] = useState<TitleSummary[] | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      void api
        .search(query, ctrl.signal)
        .then((r) => setResults(r.results))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);
  return (
    <div className="space-y-4 pt-6">
      <h2 className="px-[5rem] text-[2rem] font-bold">
        Поиск: <span className="text-muted">«{query}»</span>
      </h2>
      {results && <PosterGrid id="grid:search" items={lib.visible(results)} onOpen={onOpen} empty="По запросу ничего не найдено" />}
    </div>
  );
}

function TvScreen() {
  useTvScale();
  const engine = useSpatialEngine();
  const room = useTvRoom();
  const [tab, setTab] = useState<Tab>('home');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<OpenRequest | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState | null>(null);

  const openTitle = useCallback((t: Pick<TitleSummary, 'kind' | 'id'>, autoplay = false) => {
    setOpen({ kind: t.kind, id: t.id, autoplay, nonce: Date.now() });
  }, []);
  const onOpen = useCallback((t: TitleSummary) => openTitle(t), [openTitle]);
  const onPlay = useCallback((t: TitleSummary) => openTitle(t, true), [openTitle]);
  const closeTitle = useCallback(() => {
    setOpen(null);
    setPlayerState(null);
  }, []);

  // «Назад» на главном экране: сначала очищаем поиск, затем возвращаемся на «Главную».
  useBackHandler(() => {
    if (query) setQuery('');
    else if (tab !== 'home') setTab('home');
  }, !open);

  // ---- Сокет: команды с телефона ------------------------------------------------

  useEffect(() => {
    const s = room.socket;
    if (!s) return;
    s.on('remote_key', ({ key }) => {
      if (key === 'home') {
        setOpen(null);
        setPlayerState(null);
        setQuery('');
        setTab('home');
        return;
      }
      engine.dispatch(key, 'remote');
    });
    s.on('text_input', ({ value, submit }) => {
      setOpen(null);
      setQuery(value);
      if (submit) setTimeout(() => engine.focusSection('grid:search'), 700);
    });
    s.on('cast_media', ({ media, autoplay, startAt }) => {
      setOpen({ kind: media.kind, id: media.id, season: media.season, episode: media.episode, autoplay, startAt, nonce: Date.now() });
    });
    s.on('player_control', (cmd) => playerBus.emit(cmd));
    return () => {
      s.off('remote_key');
      s.off('text_input');
      s.off('cast_media');
      s.off('player_control');
    };
  }, [room.socket, engine]);

  // ---- Сокет: состояние TV для пульта ------------------------------------------

  const tvState: TvState = useMemo(
    () => ({ screen: playerState ? 'player' : open ? 'details' : 'browse', searchQuery: query, player: playerState }),
    [playerState, open, query],
  );
  useEffect(() => {
    if (room.socket && room.roomId) room.socket.emit('tv_state', tvState);
  }, [room.socket, room.roomId, tvState, room.peers.length]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
  }, [open]);

  return (
    <div className="tv-root min-h-dvh pb-20">
      <Header tab={tab} onTab={(t) => (setQuery(''), setTab(t))} query={query} onQuery={setQuery} />
      <main>
        {query.trim() ? (
          <SearchView query={query.trim()} onOpen={onOpen} />
        ) : tab === 'home' ? (
          <HomeView onOpen={onOpen} onPlay={onPlay} />
        ) : tab === 'lists' ? (
          <ListsView onOpen={onOpen} />
        ) : (
          <CatalogView key={tab} kind={tab} onOpen={onOpen} />
        )}
      </main>

      <AnimatePresence>
        {open && <TitleModal key={`${open.kind}:${open.id}`} request={open} onClose={closeTitle} onPlayerState={setPlayerState} />}
      </AnimatePresence>
      {/* QR сопряжения — в углу экрана; во время просмотра скрыт, чтобы не мешать. */}
      {!playerState && (
        <div className="fixed bottom-[2.5rem] right-[3rem] z-30">
          <PairingBadge room={room} />
        </div>
      )}
      <VirtualCursor socket={room.socket} />
    </div>
  );
}

export function TvApp() {
  return (
    <SpatialNavigationProvider>
      <LibraryProvider>
        <TvScreen />
      </LibraryProvider>
    </SpatialNavigationProvider>
  );
}
