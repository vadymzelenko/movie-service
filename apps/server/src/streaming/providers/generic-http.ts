import { z } from 'zod';
import type { ProviderStream, ResolveParams, StreamProvider } from './types.js';

export const genericHttpConfigSchema = z.object({
  type: z.literal('http'),
  id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  name: z.string().min(1).max(60),
  /**
   * Шаблон адреса. Подстановки: {kind} {tmdbId} {imdbId} {title} {originalTitle} {year} {season} {episode}.
   * Query-параметры, оставшиеся пустыми, удаляются: `?imdb={imdbId}` без IMDb ID не уйдёт как `imdb=`.
   */
  endpointUrl: z.string().min(8),
  headers: z.record(z.string(), z.string()).optional(),
  /** Путь к массиву потоков в JSON: `data.streams`. По умолчанию — корень или поле `streams`. */
  itemsPath: z.string().optional(),
  /** Имена полей элемента, если бэкенд называет их иначе. */
  fields: z
    .object({
      url: z.string().default('url'),
      type: z.string().default('type'),
      quality: z.string().default('quality'),
      label: z.string().default('label'),
    })
    .partial()
    .optional(),
  /** Referer для CDN этого бэкенда. */
  referer: z.url().optional(),
});
export type GenericHttpConfig = z.infer<typeof genericHttpConfigSchema>;

const PLACEHOLDER = /\{(kind|tmdbId|imdbId|title|originalTitle|year|season|episode)\}/g;

export function buildEndpoint(template: string, p: ResolveParams): string {
  const filled = template.replace(PLACEHOLDER, (_, name: keyof ResolveParams) => {
    const v = p[name];
    return v === undefined || v === null ? '' : encodeURIComponent(String(v));
  });
  const url = new URL(filled);
  for (const [k, v] of [...url.searchParams]) if (v === '') url.searchParams.delete(k);
  return url.toString();
}

function pick(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj;
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);

function inferType(url: string, declared: string | undefined): 'hls' | 'mp4' | null {
  const d = declared?.toLowerCase();
  if (d === 'hls' || d === 'm3u8' || d === 'application/vnd.apple.mpegurl' || d === 'application/x-mpegurl') return 'hls';
  if (d === 'mp4' || d === 'video/mp4') return 'mp4';
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith('.m3u8')) return 'hls';
  if (path.endsWith('.mp4') || path.endsWith('.m4v')) return 'mp4';
  return null;
}

/**
 * Провайдер для любого REST-бэкенда, который по ID тайтла отдаёт JSON с прямыми ссылками:
 *
 *   GET {endpointUrl}  →  { "streams": [ { "url": "https://…/master.m3u8", "type": "hls", "label": "Дубляж" },
 *                                         { "url": "https://…/720.mp4", "quality": "720p" } ] }
 *
 * 404 или пустой массив — «тайтла нет» (менеджер перейдёт к следующему провайдеру).
 * Подключается без кода, записью в `data/providers.json`.
 */
export class GenericHttpProvider implements StreamProvider {
  readonly id: string;
  readonly name: string;

  constructor(private readonly config: GenericHttpConfig) {
    this.id = config.id;
    this.name = config.name;
  }

  async resolveMedia(params: ResolveParams, signal?: AbortSignal): Promise<ProviderStream[] | null> {
    const url = buildEndpoint(this.config.endpointUrl, params);
    const res = await fetch(url, { headers: { accept: 'application/json', ...this.config.headers }, signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${this.id}: HTTP ${res.status}`);

    const body: unknown = await res.json();
    const items = pick(body, this.config.itemsPath) ?? body;
    const list = Array.isArray(items) ? items : Array.isArray((items as { streams?: unknown })?.streams) ? (items as { streams: unknown[] }).streams : [];
    const f = { url: 'url', type: 'type', quality: 'quality', label: 'label', ...this.config.fields };

    const streams: ProviderStream[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const rawUrl = str(item[f.url]);
      if (!rawUrl) continue;
      let abs: string;
      try {
        abs = new URL(rawUrl, url).toString();
      } catch {
        continue;
      }
      const type = inferType(abs, str(item[f.type]));
      if (!type) continue;
      streams.push({ url: abs, type, quality: str(item[f.quality]), label: str(item[f.label]), referer: this.config.referer });
    }
    return streams;
  }
}
