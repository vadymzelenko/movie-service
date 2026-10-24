import type { Review } from '@movie/shared';
import { TtlCache } from './cache.js';

const API = 'https://kinopoiskapiunofficial.tech/api';

interface KpFilm {
  kinopoiskId: number;
  imdbId?: string | null;
  ratingKinopoisk?: number | null;
  ratingImdb?: number | null;
}

interface KpReviews {
  items: {
    kinopoiskId: number;
    type?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'UNKNOWN';
    date?: string;
    author?: string;
    title?: string | null;
    description: string;
  }[];
}

export interface KpRatings {
  kinopoiskId: number;
  kinopoisk?: number;
  imdb?: number;
}

const sentiment = { POSITIVE: 'positive', NEGATIVE: 'negative', NEUTRAL: 'neutral' } as const;

/** Kinopoisk Unofficial API: рейтинги КП/IMDb и русскоязычные рецензии. */
export class KinopoiskClient {
  private cache = new TtlCache<unknown>(12 * 3600_000);

  constructor(private readonly apiKey: string) {}

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  private get<T>(path: string): Promise<T> {
    return this.cache.wrap(path, async () => {
      const res = await fetch(API + path, {
        headers: { 'X-API-KEY': this.apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Kinopoisk ${res.status} ${path}`);
      return res.json();
    }) as Promise<T>;
  }

  /** TMDB → КП сопоставляем через IMDb ID: он есть в обеих базах. */
  async ratingsByImdb(imdbId: string): Promise<KpRatings | null> {
    const data = await this.get<{ items: KpFilm[] }>(`/v2.2/films?imdbId=${encodeURIComponent(imdbId)}`);
    const film = data.items[0];
    if (!film) return null;
    return {
      kinopoiskId: film.kinopoiskId,
      kinopoisk: film.ratingKinopoisk ?? undefined,
      imdb: film.ratingImdb ?? undefined,
    };
  }

  async reviews(kinopoiskId: number): Promise<Review[]> {
    const data = await this.get<KpReviews>(`/v2.2/films/${kinopoiskId}/reviews?page=1&order=USER_POSITIVE_RATING_DESC`);
    return data.items.slice(0, 15).map((r) => ({
      id: `kp-${r.kinopoiskId}`,
      author: r.author ?? 'Зритель',
      sentiment: r.type && r.type !== 'UNKNOWN' ? sentiment[r.type] : undefined,
      title: r.title ?? undefined,
      text: r.description,
      date: r.date,
      source: 'kinopoisk' as const,
    }));
  }
}
