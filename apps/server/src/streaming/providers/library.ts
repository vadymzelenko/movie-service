import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { mediaKey, mediaRefSchema } from '@movie/shared';
import { extractStreams } from '../extractor.js';
import { fetchUpstream } from '../upstream.js';
import type { ProviderStream, ResolveParams, StreamProvider } from './types.js';

const qualitySchema = z.object({ label: z.string(), height: z.number().int().optional(), url: z.url() });

const entrySchema = z.discriminatedUnion('type', [
  z.object({ media: mediaRefSchema, voice: z.string(), type: z.literal('hls'), url: z.url(), referer: z.url().optional() }),
  z.object({ media: mediaRefSchema, voice: z.string(), type: z.literal('mp4'), qualities: z.array(qualitySchema).min(1), referer: z.url().optional() }),
  // Страница embed-плеера: поток достаёт экстрактор.
  z.object({ media: mediaRefSchema, voice: z.string(), type: z.literal('page'), url: z.url(), referer: z.url().optional() }),
]);

const fileSchema = z.object({ entries: z.array(entrySchema) });
type Entry = z.infer<typeof entrySchema>;

/**
 * Личная медиатека из `data/library.json`: файлы на NAS, Jellyfin/Plex direct-play,
 * купленные/лицензированные потоки, страницы плееров, к которым у вас есть доступ.
 * Файл перечитывается при изменении — перезапуск сервера не нужен.
 */
export class LibraryProvider implements StreamProvider {
  readonly id = 'library';
  readonly name = 'Моя медиатека';
  private cache: { mtimeMs: number; byKey: Map<string, Entry[]> } | null = null;

  constructor(
    private readonly file: string,
    private readonly extractorAllowedHosts: string[],
  ) {}

  private async load(): Promise<Map<string, Entry[]>> {
    const st = await stat(this.file).catch(() => null);
    if (!st) return new Map();
    if (this.cache?.mtimeMs === st.mtimeMs) return this.cache.byKey;
    const parsed = fileSchema.safeParse(JSON.parse(await readFile(this.file, 'utf8')));
    if (!parsed.success) {
      console.error('[library] library.json не прошёл валидацию:', z.prettifyError(parsed.error));
      return this.cache?.byKey ?? new Map();
    }
    const byKey = new Map<string, Entry[]>();
    for (const e of parsed.data.entries) byKey.set(mediaKey(e.media), [...(byKey.get(mediaKey(e.media)) ?? []), e]);
    this.cache = { mtimeMs: st.mtimeMs, byKey };
    return byKey;
  }

  async resolveMedia(p: ResolveParams): Promise<ProviderStream[] | null> {
    const key = mediaKey({ kind: p.kind, id: p.tmdbId, season: p.season, episode: p.episode });
    const entries = (await this.load()).get(key) ?? [];
    if (!entries.length) return null;
    const results = await Promise.all(entries.map((e) => this.toStreams(e).catch(() => [])));
    return results.flat();
  }

  private async toStreams(e: Entry): Promise<ProviderStream[]> {
    switch (e.type) {
      case 'hls':
        return [{ url: e.url, type: 'hls', label: e.voice, referer: e.referer }];
      case 'mp4':
        return e.qualities.map((q) => ({ url: q.url, type: 'mp4' as const, quality: q.label, label: e.voice, referer: e.referer }));
      case 'page':
        return this.fromPage(e.url, e.voice, e.referer);
    }
  }

  /** Достаём потоки со страницы плеера; вложенные iframe — только с разрешённых хостов, глубина 2. */
  private async fromPage(pageUrl: string, voice: string, referer?: string, depth = 0): Promise<ProviderStream[]> {
    const res = await fetchUpstream(pageUrl, { referer, accept: 'text/html,*/*' });
    const html = await res.text();
    const { streams, iframes } = extractStreams(html, pageUrl);
    if (streams.length) {
      return streams.map((s) => ({ url: s.url, type: s.type, quality: s.quality, label: s.voice ?? voice, referer: pageUrl }));
    }
    if (depth >= 2) return [];
    const pageHost = new URL(pageUrl).host;
    const next = iframes.find((u) => {
      const h = new URL(u).host;
      return h === pageHost || this.extractorAllowedHosts.includes(h);
    });
    return next ? this.fromPage(next, voice, pageUrl, depth + 1) : [];
  }
}
