import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { mediaKindSchema, type MediaRef, type StreamSource } from '@movie/shared';
import { cleanPlaylist, type UriKind } from './hls-cleaner.js';
import type { StreamProvider } from './providers/types.js';
import type { UrlSigner } from './signing.js';
import { fetchUpstream, UpstreamError } from './upstream.js';

const sourcesQuery = z.object({
  kind: mediaKindSchema,
  id: z.coerce.number().int(),
  season: z.coerce.number().int().min(0).optional(),
  episode: z.coerce.number().int().min(1).optional(),
});

const tokenParams = z.object({ token: z.string().min(10).max(8192), name: z.string().max(200) });

/** Последний компонент пути upstream-URL — плееры иногда ориентируются на расширение. */
function fileName(u: string, fallback: string): string {
  const last = new URL(u).pathname.split('/').pop() ?? '';
  return /^[\w.-]{1,100}$/.test(last) ? last : fallback;
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

export function registerStreamingRoutes(app: FastifyInstance, signer: UrlSigner, providers: StreamProvider[]) {
  const playlistPath = (u: string, referer?: string) => `/proxy/hls/${signer.sign({ u, r: referer })}/${fileName(u, 'index.m3u8')}`;
  const segmentPath = (u: string, referer?: string) => `/proxy/seg/${signer.sign({ u, r: referer })}/${fileName(u, 'segment')}`;

  /** Список источников (озвучка × качество) для фильма/серии. Ссылки уже указывают на наш прокси. */
  app.get('/api/sources', async (req, reply) => {
    const q = sourcesQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const media: MediaRef = { kind: q.data.kind, id: q.data.id };
    if (q.data.kind === 'tv') {
      if (q.data.season === undefined || q.data.episode === undefined) return reply.code(400).send({ error: 'season_episode_required' });
      media.season = q.data.season;
      media.episode = q.data.episode;
    }

    const settled = await Promise.allSettled(providers.map(async (p) => ({ p, sources: await p.resolve(media) })));
    const result: StreamSource[] = [];
    for (const s of settled) {
      if (s.status === 'rejected') {
        req.log.warn({ err: s.reason }, 'provider failed');
        continue;
      }
      const { p, sources } = s.value;
      sources.forEach((src, i) => {
        result.push({
          id: `${p.id}:${i}`,
          providerId: p.id,
          providerName: p.name,
          voice: src.voice,
          type: src.type,
          qualities: src.qualities.map((q) => ({
            label: q.label,
            height: q.height,
            url: src.type === 'hls' ? playlistPath(q.url, src.referer) : segmentPath(q.url, src.referer),
          })),
        });
      });
    }
    return result;
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
