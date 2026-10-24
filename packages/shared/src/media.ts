import { z } from 'zod';

/** Тип контента. Совпадает с терминологией TMDB. */
export const mediaKindSchema = z.enum(['movie', 'tv']);
export type MediaKind = z.infer<typeof mediaKindSchema>;

/**
 * Ссылка на конкретную единицу просмотра: фильм или серию сериала.
 * Передаётся по сокету (cast) и используется как ключ прогресса.
 */
export const mediaRefSchema = z
  .object({
    kind: mediaKindSchema,
    id: z.number().int(),
    season: z.number().int().min(0).optional(),
    episode: z.number().int().min(1).optional(),
  })
  .refine((m) => m.kind === 'movie' || (m.season === undefined) === (m.episode === undefined), {
    message: 'season и episode передаются вместе',
  });
export type MediaRef = z.infer<typeof mediaRefSchema>;

/** Стабильный строковый ключ: `movie:603`, `tv:1399:s1e3`. */
export function mediaKey(ref: MediaRef): string {
  if (ref.kind === 'tv' && ref.season !== undefined && ref.episode !== undefined) {
    return `tv:${ref.id}:s${ref.season}e${ref.episode}`;
  }
  return `${ref.kind}:${ref.id}`;
}

/** Ключ тайтла целиком (для сериала — без сезона/серии). */
export function titleKey(ref: Pick<MediaRef, 'kind' | 'id'>): string {
  return `${ref.kind}:${ref.id}`;
}

export function parseMediaKey(key: string): MediaRef | null {
  const m = /^(movie|tv):(-?\d+)(?::s(\d+)e(\d+))?$/.exec(key);
  if (!m) return null;
  const [, kind, id, season, episode] = m;
  const ref: MediaRef = { kind: kind as MediaKind, id: Number(id) };
  if (season !== undefined && episode !== undefined) {
    ref.season = Number(season);
    ref.episode = Number(episode);
  }
  return ref;
}

// ---------------------------------------------------------------------------
// Метаданные каталога
// ---------------------------------------------------------------------------

export interface Ratings {
  imdb?: number;
  kinopoisk?: number;
  tmdb?: number;
}

export interface TitleSummary {
  kind: MediaKind;
  id: number;
  title: string;
  originalTitle?: string;
  year?: number;
  posterUrl?: string;
  backdropUrl?: string;
  overview?: string;
  genreIds: number[];
  ratings: Ratings;
}

export interface CastMember {
  id: number;
  name: string;
  character?: string;
  photoUrl?: string;
}

export interface Review {
  id: string;
  author: string;
  /** Тип рецензии Кинопоиска: положительная / отрицательная / нейтральная. */
  sentiment?: 'positive' | 'negative' | 'neutral';
  title?: string;
  text: string;
  date?: string;
  source: 'kinopoisk' | 'tmdb';
}

export interface SeasonSummary {
  number: number;
  name: string;
  episodeCount: number;
  posterUrl?: string;
}

export interface Episode {
  season: number;
  episode: number;
  name: string;
  overview?: string;
  stillUrl?: string;
  runtimeMin?: number;
  airDate?: string;
}

export interface TitleDetails extends TitleSummary {
  tagline?: string;
  runtimeMin?: number;
  genres: Genre[];
  cast: CastMember[];
  seasons?: SeasonSummary[];
  imdbId?: string;
  kinopoiskId?: number;
}

export interface Genre {
  id: number;
  name: string;
}

export const catalogSortSchema = z.enum(['popular', 'rating', 'new']);
export type CatalogSort = z.infer<typeof catalogSortSchema>;

export const catalogQuerySchema = z.object({
  kind: mediaKindSchema.default('movie'),
  sort: catalogSortSchema.default('popular'),
  genre: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export interface Paged<T> {
  page: number;
  totalPages: number;
  results: T[];
}

// ---------------------------------------------------------------------------
// Источники потоков
// ---------------------------------------------------------------------------

export interface QualityOption {
  /** «1080p», «720p», «Auto». */
  label: string;
  height?: number;
  /** Подписанная ссылка на наш прокси. */
  url: string;
}

export interface StreamSource {
  id: string;
  providerId: string;
  providerName: string;
  /** Озвучка / студия дубляжа. */
  voice: string;
  type: 'hls' | 'mp4';
  /** «Auto» (master-плейлист) + отдельные качества, если провайдер их отдаёт. */
  qualities: QualityOption[];
}

// ---------------------------------------------------------------------------
// Прогресс и списки
// ---------------------------------------------------------------------------

export const WATCHED_THRESHOLD = 0.9;

export const progressUpdateSchema = z.object({
  position: z.number().min(0),
  duration: z.number().min(0),
  /** Принудительная отметка (ручная кнопка). */
  watched: z.boolean().optional(),
});
export type ProgressUpdate = z.infer<typeof progressUpdateSchema>;

export interface ProgressEntry {
  mediaKey: string;
  kind: MediaKind;
  id: number;
  season?: number;
  episode?: number;
  position: number;
  duration: number;
  watched: boolean;
  updatedAt: number;
}

export const listNameSchema = z.enum(['favorite', 'watch_later']);
export type ListName = z.infer<typeof listNameSchema>;

export interface ListEntry {
  list: ListName;
  kind: MediaKind;
  id: number;
  addedAt: number;
  /** Снимок карточки, чтобы список отображался без запросов к TMDB. */
  snapshot: TitleSummary;
}

export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
