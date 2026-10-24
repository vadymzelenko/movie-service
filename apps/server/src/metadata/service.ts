import type {
  CatalogQuery,
  Episode,
  Genre,
  MediaKind,
  Paged,
  Review,
  TitleDetails,
  TitleSummary,
} from '@movie/shared';
import { DEMO_EPISODES, DEMO_SERIES_ID, DEMO_TITLES, demoGenres } from './demo.js';
import { KinopoiskClient } from './kinopoisk.js';
import { TmdbClient } from './tmdb.js';

const toSummary = ({ genres: _g, cast: _c, seasons: _s, tagline: _t, runtimeMin: _r, imdbId: _i, kinopoiskId: _k, ...s }: TitleDetails): TitleSummary => s;

/**
 * Фасад метаданных: TMDB (каталог, описания, актёры, сезоны) + Кинопоиск
 * (рейтинги КП/IMDb и русские рецензии). Без ключа TMDB работает на демо-каталоге.
 */
export class MetadataService {
  constructor(
    private readonly tmdb: TmdbClient,
    private readonly kp: KinopoiskClient,
  ) {}

  get mode(): 'tmdb' | 'demo' {
    return this.tmdb.enabled ? 'tmdb' : 'demo';
  }

  async catalog(q: CatalogQuery): Promise<Paged<TitleSummary>> {
    if (!this.tmdb.enabled) {
      let items = DEMO_TITLES.filter((t) => t.kind === q.kind && (q.genre === undefined || t.genreIds.includes(q.genre)));
      if (q.sort === 'new') items = [...items].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
      return { page: 1, totalPages: 1, results: items.map(toSummary) };
    }
    return this.tmdb.catalog(q);
  }

  async search(query: string): Promise<Paged<TitleSummary>> {
    const q = query.trim().toLowerCase();
    if (!this.tmdb.enabled) {
      const results = DEMO_TITLES.filter((t) => `${t.title} ${t.originalTitle ?? ''}`.toLowerCase().includes(q)).map(toSummary);
      return { page: 1, totalPages: 1, results };
    }
    return this.tmdb.search(query);
  }

  genres(kind: MediaKind): Promise<Genre[]> {
    return this.tmdb.enabled ? this.tmdb.genres(kind) : Promise.resolve(demoGenres(kind));
  }

  async details(kind: MediaKind, id: number): Promise<TitleDetails | null> {
    const demo = DEMO_TITLES.find((t) => t.kind === kind && t.id === id);
    if (!this.tmdb.enabled || (kind === 'tv' && id === DEMO_SERIES_ID)) return demo ?? null;

    const details = await this.tmdb.details(kind, id);
    if (this.kp.enabled && details.imdbId) {
      // Рейтинги КП — приятный бонус: их недоступность не должна ломать карточку.
      const kp = await this.kp.ratingsByImdb(details.imdbId).catch(() => null);
      if (kp) {
        details.kinopoiskId = kp.kinopoiskId;
        details.ratings = { ...details.ratings, kinopoisk: kp.kinopoisk, imdb: kp.imdb };
      }
    }
    return details;
  }

  async episodes(id: number, season: number): Promise<Episode[]> {
    if (!this.tmdb.enabled || id === DEMO_SERIES_ID) return DEMO_EPISODES.filter((e) => e.season === season);
    return this.tmdb.season(id, season);
  }

  /** Сначала русские рецензии Кинопоиска, затем (если пусто) — TMDB. */
  async reviews(details: TitleDetails): Promise<Review[]> {
    if (this.kp.enabled && details.kinopoiskId) {
      const kp = await this.kp.reviews(details.kinopoiskId).catch(() => []);
      if (kp.length) return kp;
    }
    if (!this.tmdb.enabled) return [];
    return this.tmdb.reviews(details.kind, details.id).catch(() => []);
  }
}
