'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Check, Clock, Heart, Loader2, Play, RotateCcw, ThumbsDown, ThumbsUp, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatTime,
  mediaKey,
  titleKey,
  type Episode,
  type MediaKind,
  type MediaRef,
  type PlayerState,
  type ProgressEntry,
  type Review,
  type StreamSource,
  type TitleDetails,
} from '@movie/shared';
import { api } from '@/lib/api';
import { useLibrary } from '@/lib/library-store';
import { FocusSection, useBackHandler, useFocusable, useKeyHandler } from '@/lib/spatial/SpatialNavigation';
import { cn } from '@/lib/cn';
import { FocusButton } from './FocusButton';
import { Player } from './Player';
import { Ratings } from './Ratings';

export interface OpenRequest {
  kind: MediaKind;
  id: number;
  season?: number;
  episode?: number;
  autoplay?: boolean;
  startAt?: number;
  /** Меняется на каждый запрос — повторный cast того же тайтла снова запускает плеер. */
  nonce: number;
}

interface TitleModalProps {
  request: OpenRequest;
  onClose: () => void;
  onPlayerState: (s: PlayerState | null) => void;
}

interface Playing {
  media: MediaRef;
  sources: StreamSource[];
  sourceId: string;
  qualityLabel: string;
  startAt: number;
  subtitle?: string;
}

const HLS_QUALITY_CAPS = ['Авто', '2160p', '1080p', '720p', '480p'];
const VOICE_PREF_KEY = 'voice-pref';
const QUALITY_PREF_KEY = 'quality-pref';

const readPref = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writePref = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage недоступен */
  }
};

/** С какой серии продолжать: последняя начатая, а если она досмотрена — следующая. */
function resumeEpisode(progress: ProgressEntry[], episodesBySeason: Map<number, number>): { season: number; episode: number } {
  const last = progress.filter((p) => p.season !== undefined && p.episode !== undefined).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!last) {
    const first = [...episodesBySeason.keys()].sort((a, b) => a - b)[0] ?? 1;
    return { season: first, episode: 1 };
  }
  if (!last.watched) return { season: last.season!, episode: last.episode! };
  const count = episodesBySeason.get(last.season!) ?? 0;
  if (last.episode! < count) return { season: last.season!, episode: last.episode! + 1 };
  return episodesBySeason.has(last.season! + 1) ? { season: last.season! + 1, episode: 1 } : { season: last.season!, episode: last.episode! };
}

function EpisodeCard({ ep, selected, progress, onPlay }: { ep: Episode; selected: boolean; progress?: ProgressEntry; onPlay: () => void }) {
  const { ref, focused } = useFocusable<HTMLDivElement>({ id: `ep:${ep.season}:${ep.episode}`, onEnter: onPlay });
  const pct = progress && progress.duration ? progress.position / progress.duration : 0;
  return (
    <div ref={ref} className="w-[24rem] shrink-0">
      <div
        className={cn(
          'relative aspect-video overflow-hidden rounded-2xl bg-surface-2 transition-all duration-200 ease-tv',
          focused && 'focus-glow scale-105',
          selected && !focused && 'ring-[0.2rem] ring-accent',
        )}
      >
        {ep.stillUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ep.stillUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-[3rem] font-black text-white/15">{ep.episode}</div>
        )}
        {progress?.watched && (
          <span className="absolute right-3 top-3 rounded-full bg-black/70 p-1.5">
            <Check className="size-[1.3rem]" />
          </span>
        )}
        {pct > 0.01 && !progress?.watched && (
          <div className="absolute inset-x-0 bottom-0 h-[0.35rem] bg-white/20">
            <div className="h-full bg-accent" style={{ width: `${pct * 100}%` }} />
          </div>
        )}
      </div>
      <div className="mt-3 text-[1.25rem] text-muted">Серия {ep.episode}</div>
      <div className="truncate text-[1.4rem] font-semibold">{ep.name}</div>
    </div>
  );
}

function CastCard({ name, character, photoUrl, id }: { name: string; character?: string; photoUrl?: string; id: string }) {
  const { ref, focused } = useFocusable<HTMLDivElement>({ id });
  return (
    <div ref={ref} className="flex w-[12rem] shrink-0 flex-col items-center gap-3 text-center">
      <div className={cn('size-[9rem] overflow-hidden rounded-full bg-surface-2 transition-all duration-200', focused && 'focus-glow scale-105')}>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <User className="m-auto mt-[2rem] size-[5rem] text-white/20" />
        )}
      </div>
      <div className="text-[1.25rem] font-semibold leading-tight">{name}</div>
      {character && <div className="line-clamp-2 text-[1.05rem] text-muted">{character}</div>}
    </div>
  );
}

function ReviewCard({ review, onOpen }: { review: Review; onOpen: () => void }) {
  const { ref, focused } = useFocusable<HTMLDivElement>({ id: `review:${review.id}`, onEnter: onOpen });
  const Icon = review.sentiment === 'positive' ? ThumbsUp : review.sentiment === 'negative' ? ThumbsDown : null;
  return (
    <div
      ref={ref}
      className={cn(
        'flex h-[16rem] w-[36rem] shrink-0 flex-col gap-3 rounded-2xl bg-surface p-6 transition-all duration-200 ease-tv',
        focused && 'focus-glow scale-[1.03] bg-surface-2',
        review.sentiment === 'positive' && 'border-l-[0.35rem] border-emerald-500',
        review.sentiment === 'negative' && 'border-l-[0.35rem] border-rose-500',
      )}
    >
      <div className="flex items-center gap-3 text-[1.2rem] text-muted">
        {Icon && <Icon className="size-[1.4rem]" />}
        <span className="font-semibold text-white">{review.author}</span>
        {review.date && <span>· {new Date(review.date).toLocaleDateString('ru-RU')}</span>}
      </div>
      {review.title && <div className="truncate text-[1.35rem] font-semibold">{review.title}</div>}
      <p className="line-clamp-4 text-[1.2rem] leading-relaxed text-white/75">{review.text}</p>
    </div>
  );
}

function ReviewReader({ review, onClose }: { review: Review; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  useBackHandler(onClose);
  // Стрелки вверх/вниз листают длинный текст.
  useKeyHandler((key) => {
    if (key !== 'up' && key !== 'down') return false;
    boxRef.current?.scrollBy({ top: key === 'down' ? 240 : -240, behavior: 'smooth' });
    return true;
  });
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85">
      <FocusSection id="review-reader" trap className="flex max-h-[85vh] w-[80rem] flex-col gap-6 rounded-3xl bg-surface p-12">
        <div className="text-[1.4rem] text-muted">
          {review.author} {review.date && `· ${new Date(review.date).toLocaleDateString('ru-RU')}`}
        </div>
        {review.title && <h3 className="text-[2.2rem] font-bold">{review.title}</h3>}
        <div ref={boxRef} className="no-scrollbar overflow-y-auto whitespace-pre-line text-[1.5rem] leading-relaxed text-white/85">
          {review.text}
        </div>
        <FocusButton onEnter={onClose} className="self-start">
          Закрыть
        </FocusButton>
      </FocusSection>
    </motion.div>
  );
}

export function TitleModal({ request, onClose, onPlayerState }: TitleModalProps) {
  const lib = useLibrary();
  const [details, setDetails] = useState<TitleDetails | null>(null);
  const [failed, setFailed] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [titleProgress, setTitleProgress] = useState<ProgressEntry[] | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episode, setEpisode] = useState<number | null>(null);
  const [sources, setSources] = useState<StreamSource[] | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [quality, setQuality] = useState<string>(() => readPref(QUALITY_PREF_KEY) ?? 'Авто');
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [reading, setReading] = useState<Review | null>(null);
  const handledNonce = useRef<number | null>(null);

  const isTv = request.kind === 'tv';

  // ---- Загрузка ---------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setFailed(false);
    void api
      .title(request.kind, request.id)
      .then((d) => !cancelled && setDetails(d))
      .catch(() => !cancelled && setFailed(true));
    void api.reviews(request.kind, request.id).then((r) => !cancelled && setReviews(r)).catch(() => {});
    void api.titleProgress(request.kind, request.id).then((p) => !cancelled && setTitleProgress(p)).catch(() => !cancelled && setTitleProgress([]));
    return () => {
      cancelled = true;
    };
  }, [request.kind, request.id]);

  // Сезон/серия по умолчанию: из запроса (cast с телефона) или «продолжить».
  useEffect(() => {
    if (!isTv || !details?.seasons || !titleProgress) return;
    if (request.season !== undefined && request.episode !== undefined) {
      setSeason(request.season);
      setEpisode(request.episode);
      return;
    }
    const bySeason = new Map(details.seasons.map((s) => [s.number, s.episodeCount]));
    const r = resumeEpisode(titleProgress, bySeason);
    setSeason(r.season);
    setEpisode(r.episode);
  }, [isTv, details, titleProgress, request.season, request.episode, request.nonce]);

  useEffect(() => {
    if (!isTv || season === null) return;
    let cancelled = false;
    void api.episodes(request.id, season).then((e) => !cancelled && setEpisodes(e)).catch(() => setEpisodes([]));
    return () => {
      cancelled = true;
    };
  }, [isTv, request.id, season]);

  const currentRef: MediaRef | null = useMemo(() => {
    if (!isTv) return { kind: 'movie', id: request.id };
    return season !== null && episode !== null ? { kind: 'tv', id: request.id, season, episode } : null;
  }, [isTv, request.id, season, episode]);

  const pickSource = useCallback((list: StreamSource[]) => {
    const pref = readPref(VOICE_PREF_KEY);
    return (list.find((s) => s.voice === pref) ?? list[0])?.id ?? null;
  }, []);

  useEffect(() => {
    if (!currentRef) return;
    let cancelled = false;
    setSources(null);
    void api
      .sources(currentRef)
      .then((list) => {
        if (cancelled) return;
        setSources(list);
        setSourceId(pickSource(list));
      })
      .catch(() => !cancelled && setSources([]));
    return () => {
      cancelled = true;
    };
  }, [currentRef, pickSource]);

  const progressByKey = useMemo(() => new Map((titleProgress ?? []).map((p) => [p.mediaKey, p])), [titleProgress]);
  const current = currentRef ? progressByKey.get(mediaKey(currentRef)) : undefined;
  const resumable = current && !current.watched && current.position > 30 ? current.position : 0;
  const source = sources?.find((s) => s.id === sourceId);
  const qualityOptions = source?.type === 'mp4' ? source.qualities.map((q) => q.label) : HLS_QUALITY_CAPS;
  const effectiveQuality = qualityOptions.includes(quality) ? quality : (qualityOptions[0] ?? 'Авто');

  // ---- Воспроизведение ----------------------------------------------------------

  const episodeName = (s: number, e: number, list = episodes) => list.find((x) => x.season === s && x.episode === e)?.name;
  const subtitleFor = (ref: MediaRef) =>
    ref.kind === 'tv' ? `Сезон ${ref.season}, серия ${ref.episode}${episodeName(ref.season!, ref.episode!) ? ` · ${episodeName(ref.season!, ref.episode!)}` : ''}` : undefined;

  const play = useCallback(
    (ref: MediaRef, list: StreamSource[], opts: { startAt?: number; sourceId?: string | null } = {}) => {
      const sid = opts.sourceId ?? pickSource(list);
      const src = list.find((s) => s.id === sid);
      if (!src) return;
      const saved = progressByKey.get(mediaKey(ref));
      const startAt = opts.startAt ?? (saved && !saved.watched && saved.position > 30 ? saved.position : 0);
      setPlaying({ media: ref, sources: list, sourceId: src.id, qualityLabel: src.type === 'mp4' ? (src.qualities[0]?.label ?? '') : effectiveQuality, startAt, subtitle: subtitleFor(ref) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickSource, progressByKey, effectiveQuality, episodes],
  );

  // Автозапуск по cast-у с телефона / кнопке «Смотреть» на главной.
  useEffect(() => {
    if (!request.autoplay || handledNonce.current === request.nonce) return;
    if (!sources || !currentRef || !titleProgress) return;
    handledNonce.current = request.nonce;
    if (sources.length) play(currentRef, sources, { startAt: request.startAt, sourceId });
  }, [request, sources, currentRef, titleProgress, sourceId, play]);

  const playEpisode = async (ep: Episode) => {
    setSeason(ep.season);
    setEpisode(ep.episode);
    const ref: MediaRef = { kind: 'tv', id: request.id, season: ep.season, episode: ep.episode };
    const list = await api.sources(ref).catch(() => []);
    if (list.length) play(ref, list);
  };

  const nextEpisode = useMemo(() => {
    if (!playing || playing.media.kind !== 'tv') return null;
    const { season: s, episode: e } = playing.media;
    if (episodes.some((x) => x.season === s && x.episode === e! + 1)) return { season: s!, episode: e! + 1 };
    return null;
  }, [playing, episodes]);

  const closePlayer = useCallback(() => {
    setPlaying(null);
    onPlayerState(null);
    // Подтягиваем свежие таймкоды и отметки «Просмотрено».
    void api.titleProgress(request.kind, request.id).then(setTitleProgress).catch(() => {});
    void lib.refresh();
  }, [lib, onPlayerState, request.kind, request.id]);

  useBackHandler(onClose, !playing && !reading);

  // ---- Рендер -----------------------------------------------------------------

  if (failed) {
    return (
      <FocusSection id="modal" trap className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-bg">
        <p className="text-[2rem]">Не удалось загрузить информацию о тайтле</p>
        <FocusButton onEnter={onClose}>Назад</FocusButton>
      </FocusSection>
    );
  }

  const summary = details;
  const watchedTitle = lib.isWatched({ kind: request.kind, id: request.id });

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="no-scrollbar fixed inset-0 z-40 overflow-y-auto bg-bg"
      >
        {summary?.backdropUrl && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[60rem]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={summary.backdropUrl} alt="" className="size-full object-cover opacity-40" />
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-bg/90 to-transparent" />
          </div>
        )}

        <FocusSection id="modal" trap className="relative space-y-12 px-[5rem] pb-24 pt-[6rem]">
          {!summary ? (
            <div className="flex h-[60vh] items-center justify-center">
              <Loader2 className="size-[5rem] animate-spin text-white/60" />
            </div>
          ) : (
            <>
              <div className="flex gap-14">
                <div className="w-[26rem] shrink-0">
                  <div className="aspect-[2/3] overflow-hidden rounded-3xl bg-surface shadow-2xl">
                    {summary.posterUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={summary.posterUrl} alt="" className="size-full object-cover" />
                    )}
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-6">
                  <div>
                    <h1 className="text-[4rem] font-black leading-tight tracking-tight">{summary.title}</h1>
                    {summary.originalTitle && summary.originalTitle !== summary.title && (
                      <div className="text-[1.6rem] text-muted">{summary.originalTitle}</div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-[1.45rem] text-white/80">
                    <Ratings ratings={summary.ratings} />
                    {summary.year && <span>{summary.year}</span>}
                    {summary.runtimeMin ? (
                      <span className="inline-flex items-center gap-2">
                        <Clock className="size-[1.4rem]" /> {summary.runtimeMin} мин
                      </span>
                    ) : null}
                    {summary.genres.length > 0 && <span>{summary.genres.map((g) => g.name).join(', ')}</span>}
                    {watchedTitle && (
                      <span className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1">
                        <Check className="size-[1.4rem]" /> Просмотрено
                      </span>
                    )}
                  </div>
                  {summary.tagline && <div className="text-[1.6rem] italic text-white/60">«{summary.tagline}»</div>}
                  {summary.overview && <p className="max-w-[80rem] text-[1.55rem] leading-relaxed text-white/85">{summary.overview}</p>}

                  {/* Действия */}
                  <FocusSection id="modal:actions" className="flex flex-wrap gap-4 pt-2">
                    {sources === null ? (
                      <FocusButton id="modal:play" variant="primary" disabled>
                        <Loader2 className="size-[1.8rem] animate-spin" /> Ищем источники…
                      </FocusButton>
                    ) : sources.length === 0 ? (
                      <FocusButton id="modal:play" variant="secondary" disabled>
                        Источники не найдены
                      </FocusButton>
                    ) : (
                      <>
                        <FocusButton id="modal:play" variant="primary" autoFocus onEnter={() => currentRef && play(currentRef, sources, { startAt: resumable, sourceId })}>
                          <Play className="size-[1.8rem] fill-current" />
                          {resumable ? `Смотреть с ${formatTime(resumable)}` : 'Смотреть'}
                          {isTv && season !== null && episode !== null && <span className="font-normal opacity-60">S{season}E{episode}</span>}
                        </FocusButton>
                        {resumable > 0 && (
                          <FocusButton id="modal:restart" onEnter={() => currentRef && play(currentRef, sources, { startAt: 0, sourceId })}>
                            <RotateCcw className="size-[1.8rem]" /> Смотреть заново
                          </FocusButton>
                        )}
                      </>
                    )}
                    <FocusButton id="modal:watched" selected={watchedTitle} onEnter={() => void lib.setWatched(titleKey(summary), !watchedTitle)}>
                      <Check className="size-[1.8rem]" /> {watchedTitle ? 'Просмотрено' : 'Отметить просмотренным'}
                    </FocusButton>
                    <FocusButton id="modal:fav" ariaLabel="Избранное" onEnter={() => void lib.toggleList('favorite', summary)}>
                      <Heart className={cn('size-[1.8rem]', lib.inList('favorite', summary) && 'fill-accent text-accent')} />
                    </FocusButton>
                    <FocusButton id="modal:later" onEnter={() => void lib.toggleList('watch_later', summary)}>
                      <Bookmark className={cn('size-[1.8rem]', lib.inList('watch_later', summary) && 'fill-current')} />
                      {lib.inList('watch_later', summary) ? 'В списке' : 'Посмотреть позже'}
                    </FocusButton>
                  </FocusSection>

                  {/* Озвучка и качество */}
                  {sources && sources.length > 0 && (
                    <div className="space-y-4">
                      <FocusSection id="modal:voices" className="flex flex-wrap items-center gap-3">
                        <span className="w-[11rem] text-[1.3rem] text-muted">Озвучка</span>
                        {sources.map((s) => (
                          <FocusButton
                            key={s.id}
                            variant="chip"
                            selected={s.id === sourceId}
                            onEnter={() => {
                              setSourceId(s.id);
                              writePref(VOICE_PREF_KEY, s.voice);
                            }}
                          >
                            {s.voice}
                            {sources.filter((x) => x.voice === s.voice).length > 1 && <span className="opacity-60">· {s.providerName}</span>}
                          </FocusButton>
                        ))}
                      </FocusSection>
                      <FocusSection id="modal:quality" className="flex flex-wrap items-center gap-3">
                        <span className="w-[11rem] text-[1.3rem] text-muted">Качество</span>
                        {qualityOptions.map((q) => (
                          <FocusButton
                            key={q}
                            variant="chip"
                            selected={q === effectiveQuality}
                            onEnter={() => {
                              setQuality(q);
                              writePref(QUALITY_PREF_KEY, q);
                            }}
                          >
                            {q}
                          </FocusButton>
                        ))}
                      </FocusSection>
                    </div>
                  )}
                </div>
              </div>

              {/* Сезоны и серии */}
              {isTv && summary.seasons && summary.seasons.length > 0 && (
                <section className="space-y-6">
                  <FocusSection id="modal:seasons" remember className="no-scrollbar flex gap-3 overflow-x-auto py-2">
                    {summary.seasons.map((s) => (
                      <FocusButton key={s.number} variant="chip" selected={s.number === season} onEnter={() => setSeason(s.number)}>
                        {s.name || `Сезон ${s.number}`}
                      </FocusButton>
                    ))}
                  </FocusSection>
                  <FocusSection id="modal:episodes" remember className="no-scrollbar -mx-[5rem] flex gap-6 overflow-x-auto px-[5rem] py-4">
                    {episodes.map((ep) => (
                      <EpisodeCard
                        key={`${ep.season}:${ep.episode}`}
                        ep={ep}
                        selected={ep.season === season && ep.episode === episode}
                        progress={progressByKey.get(mediaKey({ kind: 'tv', id: request.id, season: ep.season, episode: ep.episode }))}
                        onPlay={() => void playEpisode(ep)}
                      />
                    ))}
                  </FocusSection>
                </section>
              )}

              {summary.cast.length > 0 && (
                <section className="space-y-5">
                  <h2 className="text-[2rem] font-bold">В ролях</h2>
                  <FocusSection id="modal:cast" remember className="no-scrollbar -mx-[5rem] flex gap-6 overflow-x-auto px-[5rem] py-4">
                    {summary.cast.map((c) => (
                      <CastCard key={c.id} id={`cast:${c.id}`} name={c.name} character={c.character} photoUrl={c.photoUrl} />
                    ))}
                  </FocusSection>
                </section>
              )}

              {reviews.length > 0 && (
                <section className="space-y-5">
                  <h2 className="text-[2rem] font-bold">Рецензии зрителей</h2>
                  <FocusSection id="modal:reviews" remember className="no-scrollbar -mx-[5rem] flex gap-6 overflow-x-auto px-[5rem] py-4">
                    {reviews.map((r) => (
                      <ReviewCard key={r.id} review={r} onOpen={() => setReading(r)} />
                    ))}
                  </FocusSection>
                </section>
              )}
            </>
          )}
        </FocusSection>
      </motion.div>

      <AnimatePresence>{reading && <ReviewReader key="reader" review={reading} onClose={() => setReading(null)} />}</AnimatePresence>

      {playing && summary && (
        <Player
          key={`${mediaKey(playing.media)}:${playing.sourceId}`}
          media={playing.media}
          title={summary.title}
          subtitle={playing.subtitle}
          sources={playing.sources}
          sourceId={playing.sourceId}
          qualityLabel={playing.qualityLabel}
          startAt={playing.startAt}
          onClose={closePlayer}
          onState={onPlayerState}
          onNext={
            nextEpisode
              ? () => {
                  const ep = episodes.find((x) => x.season === nextEpisode.season && x.episode === nextEpisode.episode);
                  if (ep) void playEpisode(ep);
                }
              : undefined
          }
        />
      )}
    </>
  );
}
