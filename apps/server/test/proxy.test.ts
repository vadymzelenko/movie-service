import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import Fastify from 'fastify';
import type { SourcesResponse } from '@movie/shared';
import { ProviderManager } from '../src/streaming/provider-manager.js';
import type { ProviderStream, ResolveParams, StreamProvider } from '../src/streaming/providers/types.js';
import { registerStreamingRoutes } from '../src/streaming/routes.js';
import { UrlSigner } from '../src/streaming/signing.js';

describe('прокси: манифест → очистка → сегменты', () => {
  let upstream: Server;
  let origin = '';
  const seen: { url: string; referer?: string; range?: string }[] = [];
  const app = Fastify({ maxParamLength: 8192 });

  before(async () => {
    upstream = createServer((req, res) => {
      seen.push({ url: req.url!, referer: req.headers.referer, range: req.headers.range });
      if (req.url === '/master.m3u8') {
        res.setHeader('content-type', 'application/vnd.apple.mpegurl');
        return res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\nv720/index.m3u8\n');
      }
      if (req.url === '/v720/index.m3u8') {
        return res.end(
          [
            '#EXTM3U',
            '#EXT-X-TARGETDURATION:6',
            '#EXTINF:6,', '/ads/preroll0.ts',
            '#EXT-X-DISCONTINUITY',
            '#EXTINF:6,', 's0.ts',
            '#EXTINF:6,', 's1.ts',
            '#EXT-X-ENDLIST',
          ].join('\n'),
        );
      }
      if (req.url === '/v720/s0.ts') {
        if (req.headers.range === 'bytes=0-3') {
          res.writeHead(206, { 'content-range': 'bytes 0-3/10', 'content-type': 'video/mp2t' });
          return res.end('SEG0');
        }
        return res.end('SEG0-FULL!');
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

    const provider: StreamProvider = {
      id: 'test',
      name: 'Test',
      async resolveMedia(p: ResolveParams): Promise<ProviderStream[] | null> {
        if (p.tmdbId !== 1) return null;
        return [{ label: 'Дубляж', type: 'hls', url: `${origin}/master.m3u8`, referer: 'https://player.example/' }];
      },
    };
    registerStreamingRoutes(app, new UrlSigner('test', 600), new ProviderManager([provider]), async () => ({}));
    await app.ready();
  });

  after(async () => {
    await app.close();
    upstream.close();
  });

  it('проходит всю цепочку и вырезает преролл', async () => {
    const res = (await app.inject('/api/sources?kind=movie&id=1')).json<SourcesResponse>();
    assert.equal(res.providerId, 'test');
    const sources = res.sources;
    assert.equal(sources.length, 1);
    assert.equal(sources[0]!.voice, 'Дубляж');
    const masterPath = sources[0]!.qualities[0]!.url;
    assert.ok(!masterPath.includes('127.0.0.1'), 'upstream не утекает клиенту');

    const master = await app.inject(masterPath);
    assert.equal(master.statusCode, 200);
    const variantPath = master.body.split('\n').find((l) => l.startsWith('/proxy/hls/'))!;

    const media = await app.inject(variantPath);
    assert.equal(media.headers['x-ads-removed-segments'], '1');
    const segPaths = media.body.split('\n').filter((l) => l.startsWith('/proxy/seg/'));
    assert.equal(segPaths.length, 2);
    assert.ok(!media.body.includes('DISCONTINUITY'));

    const seg = await app.inject({ url: segPaths[0]!, headers: { range: 'bytes=0-3' } });
    assert.equal(seg.statusCode, 206);
    assert.equal(seg.headers['content-range'], 'bytes 0-3/10');
    assert.equal(seg.body, 'SEG0');
    assert.ok(seen.every((r) => r.referer === 'https://player.example/'), 'Referer пробрасывается в CDN');
    assert.ok(!seen.some((r) => r.url.includes('/ads/')), 'рекламный сегмент даже не скачивается');
  });

  it('отвергает неподписанные ссылки', async () => {
    const forged = Buffer.from(JSON.stringify({ u: `${origin}/master.m3u8`, e: 9e9 })).toString('base64url');
    assert.equal((await app.inject(`/proxy/hls/${forged}AAAAAAAAAAAAAAAAAAAAAAAA/x.m3u8`)).statusCode, 403);
    assert.equal((await app.inject('/api/sources?kind=tv&id=1')).statusCode, 400);
  });
});
