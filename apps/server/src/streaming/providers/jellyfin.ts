import { z } from 'zod';
import type { MediaKind } from '@movie/shared';
import type { ProviderStream, ResolveParams, StreamProvider } from './types.js';

export const jellyfinConfigSchema = z.object({
  type: z.literal('jellyfin'),
  id: z.string().regex(/^[a-z0-9_-]{1,32}$/).default('jellyfin'),
  name: z.string().min(1).max(60).default('Jellyfin'),
  /** http://192.168.1.10:8096 */
  baseUrl: z.url(),
  /** Dashboard → API Keys. */
  apiKey: z.string().min(16),
  /** Нужен для Jellyfin < 10.9 (там библиотека доступна только в контексте пользователя). */
  userId: z.string().optional(),
  /** Отдавать оригинальный файл без перекодирования, если браузер TV его скорее всего потянет. */
  directPlay: z.boolean().default(true),
});
export type JellyfinConfig = z.infer<typeof jellyfinConfigSchema>;

interface JfMediaStream {
  Type: 'Video' | 'Audio' | 'Subtitle' | string;
  Index: number;
  Codec?: string;
  Language?: string;
  Title?: string;
  DisplayTitle?: string;
  IsDefault?: boolean;
}

interface JfMediaSource {
  Id: string;
  Container?: string;
  MediaStreams?: JfMediaStream[];
}

interface JfItem {
  Id: string;
  Name: string;
  Type: 'Movie' | 'Series' | 'Episode' | string;
  ProductionYear?: number;
  ProviderIds?: Record<string, string>;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  MediaSources?: JfMediaSource[];
}

/** Перекодирование для «Качества»: потолок высоты и битрейт. */
const TRANSCODE_PROFILES: { label: string; params: Record<string, string> }[] = [
  { label: 'Авто', params: { MaxStreamingBitrate: '40000000' } },
  { label: '1080p', params: { MaxHeight: '1080', VideoBitrate: '8000000' } },
  { label: '720p', params: { MaxHeight: '720', VideoBitrate: '4000000' } },
  { label: '480p', params: { MaxHeight: '480', VideoBitrate: '1500000' } },
  { label: '360p', params: { MaxHeight: '360', VideoBitrate: '800000' } },
];

const INDEX_TTL_MS = 10 * 60_000;
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Коннектор к своему серверу Jellyfin.
 *
 * Сопоставление: TMDB/IMDb ID из метаданных Jellyfin (индекс библиотеки кэшируется на 10 минут),
 * запасной путь — поиск по названию и году. Для сериала находится сериал, затем серия
 * по номерам сезона/эпизода.
 *
 * Потоки: каждая аудиодорожка файла становится отдельной «озвучкой», каждый профиль
 * перекодирования — «качеством» (`/Videos/{id}/master.m3u8`). Ключ API уходит только в
 * зашифрованные прокси-ссылки сервера, в браузер он не попадает.
 */
export class JellyfinProvider implements StreamProvider {
  readonly id: string;
  readonly name: string;
  private readonly base: string;
  private index = new Map<MediaKind, { expires: number; byId: Map<string, JfItem>; items: JfItem[] }>();

  constructor(private readonly config: JellyfinConfig) {
    this.id = config.id;
    this.name = config.name;
    this.base = config.baseUrl.replace(/\/+$/, '');
  }

  // ---- HTTP ------------------------------------------------------------------

  private async get<T>(path: string, query: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    if (this.config.userId) url.searchParams.set('userId', this.config.userId);
    const res = await fetch(url, {
      signal,
      headers: {
        accept: 'application/json',
        authorization: `MediaBrowser Client="Kinozal", Device="Server", DeviceId="kinozal-server", Version="1.0", Token="${this.config.apiKey}"`,
      },
    });
    if (!res.ok) throw new Error(`jellyfin: HTTP ${res.status} ${path}`);
    return (await res.json()) as T;
  }

  /** Индекс библиотеки по TMDB/IMDb: один запрос раз в 10 минут вместо поиска на каждый тайтл. */
  private async libraryIndex(kind: MediaKind, signal?: AbortSignal) {
    const cached = this.index.get(kind);
    if (cached && cached.expires > Date.now()) return cached;
    const data = await this.get<{ Items: JfItem[] }>(
      '/Items',
      { Recursive: 'true', IncludeItemTypes: kind === 'movie' ? 'Movie' : 'Series', Fields: 'ProviderIds', EnableImages: 'false', Limit: 20000 },
      signal,
    );
    const byId = new Map<string, JfItem>();
    for (const it of data.Items) {
      const ids = it.ProviderIds ?? {};
      for (const [k, v] of Object.entries(ids)) if (v) byId.set(`${k.toLowerCase()}:${v.toLowerCase()}`, it);
    }
    const entry = { expires: Date.now() + INDEX_TTL_MS, byId, items: data.Items };
    this.index.set(kind, entry);
    return entry;
  }

  private async findTitle(p: ResolveParams, signal?: AbortSignal): Promise<JfItem | null> {
    const idx = await this.libraryIndex(p.kind, signal);
    const byTmdb = idx.byId.get(`tmdb:${p.tmdbId}`);
    if (byTmdb) return byTmdb;
    if (p.imdbId) {
      const byImdb = idx.byId.get(`imdb:${p.imdbId.toLowerCase()}`);
      if (byImdb) return byImdb;
    }
    // Файлы без внешних ID: название (локализованное или оригинальное) + год ±1.
    const names = [p.title, p.originalTitle].filter((x): x is string => !!x).map(norm);
    if (!names.length) return null;
    return (
      idx.items.find((it) => names.includes(norm(it.Name)) && (!p.year || !it.ProductionYear || Math.abs(it.ProductionYear - p.year) <= 1)) ?? null
    );
  }

  private async withMedia(itemId: string, signal?: AbortSignal): Promise<JfItem | null> {
    const data = await this.get<{ Items: JfItem[] }>('/Items', { ids: itemId, Fields: 'MediaSources,MediaStreams' }, signal);
    return data.Items[0] ?? null;
  }

  private async findEpisode(seriesId: string, season: number, episode: number, signal?: AbortSignal): Promise<JfItem | null> {
    const data = await this.get<{ Items: JfItem[] }>(`/Shows/${seriesId}/Episodes`, { season, Fields: 'MediaSources,MediaStreams' }, signal);
    return data.Items.find((e) => e.ParentIndexNumber === season && e.IndexNumber === episode) ?? null;
  }

  // ---- StreamProvider -----------------------------------------------------------

  async resolveMedia(p: ResolveParams, signal?: AbortSignal): Promise<ProviderStream[] | null> {
    const title = await this.findTitle(p, signal);
    if (!title) return null;

    let item: JfItem | null;
    if (p.kind === 'tv') {
      if (p.season === undefined || p.episode === undefined) return null;
      item = await this.findEpisode(title.Id, p.season, p.episode, signal);
    } else {
      item = await this.withMedia(title.Id, signal);
    }
    const source = item?.MediaSources?.[0];
    if (!item || !source) return null;
    return this.streamsFor(item.Id, source);
  }

  streamsFor(itemId: string, source: JfMediaSource): ProviderStream[] {
    const streams = source.MediaStreams ?? [];
    const audio = streams.filter((s) => s.Type === 'Audio');
    const video = streams.find((s) => s.Type === 'Video');
    const tracks = audio.length ? audio : [undefined];
    const out: ProviderStream[] = [];

    for (const track of tracks) {
      const label = track ? track.Title || track.DisplayTitle || track.Language || `Дорожка ${track.Index}` : 'Оригинал';
      for (const profile of TRANSCODE_PROFILES) {
        const url = new URL(`${this.base}/Videos/${itemId}/master.m3u8`);
        const q: Record<string, string> = {
          MediaSourceId: source.Id,
          DeviceId: 'kinozal-tv',
          VideoCodec: 'h264',
          AudioCodec: 'aac',
          TranscodingMaxAudioChannels: '2',
          SegmentContainer: 'ts',
          api_key: this.config.apiKey,
          ...profile.params,
        };
        if (track) q.AudioStreamIndex = String(track.Index);
        for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
        out.push({ url: url.toString(), type: 'hls', quality: profile.label, label });
      }
    }

    // Оригинальный файл без перекодирования — только если это H.264 в MP4: такое играет любой TV.
    const container = source.Container?.toLowerCase() ?? '';
    if (this.config.directPlay && /mp4|m4v|mov/.test(container) && video?.Codec?.toLowerCase() === 'h264') {
      const url = new URL(`${this.base}/Videos/${itemId}/stream`);
      url.searchParams.set('static', 'true');
      url.searchParams.set('MediaSourceId', source.Id);
      url.searchParams.set('api_key', this.config.apiKey);
      out.push({ url: url.toString(), type: 'mp4', quality: 'Оригинал', label: 'Оригинальный файл' });
    }
    return out;
  }
}
