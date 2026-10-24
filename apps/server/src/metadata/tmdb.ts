import type {
  CastMember,
  CatalogQuery,
  Episode,
  Genre,
  MediaKind,
  Paged,
  Review,
  SeasonSummary,
  TitleDetails,
  TitleSummary,
} from '@movie/shared';
import { TtlCache } from './cache.js';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const LANG = 'ru-RU';

// ---- Сырые ответы TMDB (только используемые поля) -------------------------

interface TmdbListItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  genre_ids?: number[];
  vote_average?: number;
  media_type?: string;
}

interface TmdbDetails extends Omit<TmdbListItem, 'genre_ids'> {
  tagline?: string;
  runtime?: number | null;
  episode_run_time?: number[];
  genres: Genre[];
  imdb_id?: string | null;
  external_ids?: { imdb_id?: string | null };
  credits?: { cast: { id: number; name: string; character?: string; profile_path?: string | null }[] };
  seasons?: { season_number: number; name: string; episode_count: number; poster_path?: string | null }[];
}

interface TmdbSeason {
  episodes: {
    season_number: number;
    episode_number: number;
    name: string;
    overview?: string;
    still_path?: string | null;
    runtime?: number | null;
    air_date?: string | null;
  }[];
}

interface TmdbReviews {
  results: { id: string; author: string; content: string; created_at?: string }[];
}

const img = (p: string | null | undefined, size: string) => (p ? `${IMG}/${size}${p}` : undefined);
const year = (d?: string) => (d && d.length >= 4 ? Number(d.slice(0, 4)) : undefined);

export function mapSummary(kind: MediaKind, it: TmdbListItem): TitleSummary {
  return {
    kind,
    id: it.id,
    title: it.title ?? it.name ?? '',
    originalTitle: it.original_title ?? it.original_name,
    year: year(it.release_date ?? it.first_air_date),
    posterUrl: img(it.poster_path, 'w500'),
    backdropUrl: img(it.backdrop_path, 'w1280'),
    overview: it.overview || undefined,
    genreIds: it.genre_ids ?? [],
    ratings: it.vote_average ? { tmdb: Math.round(it.vote_average * 10) / 10 } : {},
  };
}

export class TmdbClient {
  private cache = new TtlCache<unknown>(6 * 3600_000);

  constructor(private readonly apiKey: string) {}

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(API + path);
    url.searchParams.set('language', LANG);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: 'application/json' };
    // Поддерживаем оба формата ключа: v4 Bearer-токен (JWT) и классический v3 api_key.
    if (this.apiKey.startsWith('eyJ')) headers.authorization = `Bearer ${this.apiKey}`;
    else url.searchParams.set('api_key', this.apiKey);

    const key = url.toString();
    return this.cache.wrap(key, async () => {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`TMDB ${res.status} ${path}`);
      return res.json();
    }) as Promise<T>;
  }

  async catalog(q: CatalogQuery): Promise<Paged<TitleSummary>> {
    const isMovie = q.kind === 'movie';
    const today = new Date().toISOString().slice(0, 10);
    const sortBy = { popular: 'popularity.desc', rating: 'vote_average.desc', new: isMovie ? 'primary_release_date.desc' : 'first_air_date.desc' }[q.sort];
    const data = await this.get<{ page: number; total_pages: number; results: TmdbListItem[] }>(`/discover/${q.kind}`, {
      sort_by: sortBy,
      page: q.page,
      with_genres: q.genre,
      // Без порога по голосам «топ по рейтингу» забит фильмами с одной оценкой 10/10.
      'vote_count.gte': q.sort === 'rating' ? 1000 : q.sort === 'new' ? 50 : undefined,
      [isMovie ? 'primary_release_date.lte' : 'first_air_date.lte']: today,
      include_adult: 'false',
    });
    return {
      page: data.page,
      totalPages: Math.min(data.total_pages, 500),
      results: data.results.map((r) => mapSummary(q.kind, r)),
    };
  }

  async search(query: string, page = 1): Promise<Paged<TitleSummary>> {
    const data = await this.get<{ page: number; total_pages: number; results: TmdbListItem[] }>('/search/multi', {
      query,
      page,
      include_adult: 'false',
    });
    return {
      page: data.page,
      totalPages: data.total_pages,
      results: data.results
        .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
        .map((r) => mapSummary(r.media_type as MediaKind, r)),
    };
  }

  async genres(kind: MediaKind): Promise<Genre[]> {
    const data = await this.get<{ genres: Genre[] }>(`/genre/${kind}/list`);
    return data.genres;
  }

  async details(kind: MediaKind, id: number): Promise<TitleDetails> {
    const d = await this.get<TmdbDetails>(`/${kind}/${id}`, { append_to_response: 'credits,external_ids' });
    const base = mapSummary(kind, { ...d, genre_ids: d.genres.map((g) => g.id) });
    const cast: CastMember[] = (d.credits?.cast ?? []).slice(0, 15).map((c) => ({
      id: c.id,
      name: c.name,
      character: c.character || undefined,
      photoUrl: img(c.profile_path, 'w185'),
    }));
    const seasons: SeasonSummary[] | undefined = d.seasons
      ?.filter((s) => s.season_number > 0 && s.episode_count > 0)
      .map((s) => ({ number: s.season_number, name: s.name, episodeCount: s.episode_count, posterUrl: img(s.poster_path, 'w342') }));
    return {
      ...base,
      posterUrl: img(d.poster_path, 'original') ?? base.posterUrl,
      backdropUrl: img(d.backdrop_path, 'original') ?? base.backdropUrl,
      tagline: d.tagline || undefined,
      runtimeMin: d.runtime ?? d.episode_run_time?.[0] ?? undefined,
      genres: d.genres,
      cast,
      seasons,
      imdbId: d.imdb_id ?? d.external_ids?.imdb_id ?? undefined,
    };
  }

  async season(id: number, season: number): Promise<Episode[]> {
    const d = await this.get<TmdbSeason>(`/tv/${id}/season/${season}`);
    return d.episodes.map((e) => ({
      season: e.season_number,
      episode: e.episode_number,
      name: e.name,
      overview: e.overview || undefined,
      stillUrl: img(e.still_path, 'w500'),
      runtimeMin: e.runtime ?? undefined,
      airDate: e.air_date ?? undefined,
    }));
  }

  /** TMDB-рецензии почти всегда на английском — используются как запасной вариант к Кинопоиску. */
  async reviews(kind: MediaKind, id: number): Promise<Review[]> {
    const d = await this.get<TmdbReviews>(`/${kind}/${id}/reviews`, { language: 'en-US' });
    return d.results.slice(0, 10).map((r) => ({
      id: `tmdb-${r.id}`,
      author: r.author,
      text: r.content,
      date: r.created_at,
      source: 'tmdb' as const,
    }));
  }
}
