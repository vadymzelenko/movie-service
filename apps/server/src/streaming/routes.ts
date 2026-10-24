import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { mediaKindSchema, type SourcesResponse, type StreamSource } from '@movie/shared';
import { cleanPlaylist, type UriKind } from './hls-cleaner.js';
import type { ProviderManager } from './provider-manager.js';
import type { ProviderStream, ResolveParams } from './providers/types.js';
import type { UrlSigner } from './signing.js';
import { fetchUpstream, UpstreamError } from './upstream.js';

const sourcesQuery = z.object({
  kind: mediaKindSchema,
  id: z.coerce.number().int(),
  season: z.coerce.number().int().min(0).optional(),
  episode: z.coerce.number().int().min(1).optional(),
  /** Выбранный пользователем источник («Источник 2»). */
  provider: z.string().max(32).optional(),
  /** Провайдеры через запятую, которые пропустить (их поток упал в плеере). */
  exclude: z.string().max(400).optional(),
});

/** Метаданные тайтла для сопоставления у провайдеров (IMDb ID, названия, год). */
export type DescribeTitle = (kind: ResolveParams['kind'], tmdbId: number) => Promise<Omit<ResolveParams, 'kind' | 'tmdbId' | 'season' | 'episode'>>;

const heightOf = (label?: string) => Number(/(\d{3,4})p/i.exec(label ?? '')?.[1] ?? 0) || undefined;

const tokenParams = z.object({ token: z.string().min(10).max(8192), name: z.string().max(200) });

/** Последний компонент пути upstream-URL — плееры иногда ориентируются на расширение. */
function fileName(u: string, fallback: string): string {
  const last = new URL(u).pathname.split('/').pop() ?? '';
  return /^[\w.-]{1,100}$/.test(last) ? last : fallback;
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

export function registerStreamingRoutes(app: FastifyInstance, signer: UrlSigner, manager: ProviderManager, describe: DescribeTitle) {
  const playlistPath = (u: string, referer?: string) => `/proxy/hls/${signer.sign({ u, r: referer })}/${fileName(u, 'index.m3u8')}`;
  const segmentPath = (u: string, referer?: string) => `/proxy/seg/${signer.sign({ u, r: referer })}/${fileName(u, 'segment')}`;

  /** Потоки одного провайдера → источники UI: группа = озвучка × тип, внутри — качества. */
  const toSources = (providerId: string, providerName: string, streams: ProviderStream[]): StreamSource[] => {
    const groups = new Map<string, StreamSource>();
    for (const st of streams) {
      const voice = st.label || 'Оригинал';
      const key = `${voice}|${st.type}`;
      let g = groups.get(key);
      if (!g) {
        g = { id: `${providerId}:${groups.size}`, providerId, providerName, voice, type: st.type, qualities: [] };
        groups.set(key, g);
      }
      const label = st.quality || (st.type === 'hls' ? 'Авто' : 'MP4');
      if (g.qualities.some((q) => q.label === label)) continue;
      g.qualities.push({ label, height: heightOf(label), url: st.type === 'hls' ? playlistPath(st.url, st.referer) : segmentPath(st.url, st.referer) });
    }
    for (const g of groups.values()) g.qualities.sort((a, b) => (b.height ?? Infinity) - (a.height ?? Infinity));
    return [...groups.values()];
  };

  /**
   * Источники для фильма/серии с фоллбеком по цепочке провайдеров.
   * Ссылки уже указывают на наш прокси; upstream-адреса и ключи клиенту не видны.
   */
  app.get('/api/sources', async (req, reply): Promise<SourcesResponse | undefined> => {
    const q = sourcesQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const { kind, id, season, episode, provider, exclude } = q.data;
    if (kind === 'tv' && (season === undefined || episode === undefined)) return reply.code(400).send({ error: 'season_episode_required' });

    const meta = await describe(kind, id).catch(() => ({}));
    const params: ResolveParams = { ...meta, kind, tmdbId: id, ...(kind === 'tv' ? { season, episode } : {}) };
    const result = await manager.resolveWithFallback(params, {
      preferred: provider,
      exclude: exclude?.split(',').filter(Boolean),
    });
    const active = result.providers.find((p) => p.id === result.providerId);
    return {
      providerId: result.providerId,
      sources: active ? toSources(active.id, active.name, result.streams) : [],
      providers: result.providers.map(({ id: pid, name, status }) => ({ id: pid, name, status })),
    };
  });

  /** Манифест: скачиваем, вырезаем рекламу, переписываем все URI на прокси. */
  app.get('/proxy/hls/:token/:name', async (req, reply) => {
    const params = tokenParams.safeParse(req.params);
    const target = params.success ? signer.verify(params.data.token) : null;
    if (!target) return reply.code(403).send({ error: 'bad_signature' });

    try {
      const res = await fetchUpstream(target.u, { referer: target.r, accept: 'application/vnd.apple.mpegurl,*/*' });
      // После редиректа относительные пути считаются от конечного URL.
      const baseUrl = res.url || target.u;
      const text = await res.text();
      const cleaned = cleanPlaylist(text, {
        baseUrl,
        rewrite: (abs: string, kind: UriKind) => (kind === 'playlist' ? playlistPath(abs, target.r) : segmentPath(abs, target.r)),
      });
      if (cleaned.removedSegments || cleaned.reasons.length) {
        req.log.info({ host: new URL(baseUrl).host, ...cleaned, body: undefined }, 'hls: ads removed');
      }
      return reply
        .header('content-type', 'application/vnd.apple.mpegurl')
        .header('cache-control', 'no-cache')
        .header('x-ads-removed-segments', String(cleaned.removedSegments))
        .header('x-ads-removed-seconds', String(cleaned.removedSeconds))
        .header('access-control-expose-headers', 'x-ads-removed-segments, x-ads-removed-seconds')
        .send(cleaned.body);
    } catch (err) {
      return upstreamFailure(reply, err);
    }
  });

  /** Сегменты, ключи, init-секции и MP4 — потоковая передача с поддержкой Range. */
  app.get('/proxy/seg/:token/:name', async (req, reply) => {
    const params = tokenParams.safeParse(req.params);
    const target = params.success ? signer.verify(params.data.token) : null;
    if (!target) return reply.code(403).send({ error: 'bad_signature' });

    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());
    try {
      const res = await fetchUpstream(target.u, {
        referer: target.r,
        range: req.headers.range,
        timeoutMs: 60_000,
        signal: abort.signal,
      });
      reply.code(res.status);
      for (const h of PASS_HEADERS) {
        const v = res.headers.get(h);
        if (v) reply.header(h, v);
      }
      reply.header('cache-control', 'public, max-age=3600');
      if (!res.body) return reply.send();
      return reply.send(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream));
    } catch (err) {
      if (abort.signal.aborted) return reply;
      return upstreamFailure(reply, err);
    }
  });
}

function upstreamFailure(reply: FastifyReply, err: unknown) {
  if (err instanceof UpstreamError) return reply.code(err.status === 404 ? 404 : 502).send({ error: 'upstream', status: err.status });
  reply.log.error({ err }, 'proxy failure');
  return reply.code(502).send({ error: 'upstream_unreachable' });
}
