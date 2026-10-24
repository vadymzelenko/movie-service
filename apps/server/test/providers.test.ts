import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { ProviderManager } from '../src/streaming/provider-manager.js';
import { buildEndpoint, GenericHttpProvider } from '../src/streaming/providers/generic-http.js';
import { JellyfinProvider } from '../src/streaming/providers/jellyfin.js';
import type { ProviderStream, ResolveParams, StreamProvider } from '../src/streaming/providers/types.js';

const movie: ResolveParams = { kind: 'movie', tmdbId: 603, imdbId: 'tt0133093', title: 'Матрица', originalTitle: 'The Matrix', year: 1999 };

const fake = (id: string, impl: (p: ResolveParams) => Promise<ProviderStream[] | null>) => {
  let calls = 0;
  const provider: StreamProvider = {
    id,
    name: id.toUpperCase(),
    resolveMedia: (p) => (calls++, impl(p)),
  };
  return { provider, calls: () => calls };
};

const hls = (url: string): ProviderStream[] => [{ url, type: 'hls', label: 'Дубляж' }];

function mockServer(handler: (req: IncomingMessage, res: ServerResponse, url: URL) => void) {
  let server: Server;
  let origin = '';
  const seen: URL[] = [];
  return {
    start: async () => {
      server = createServer((req, res) => {
        const url = new URL(req.url!, origin);
        seen.push(url);
        handler(req, res, url);
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      return origin;
    },
    stop: () => server.close(),
    seen,
  };
}

const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

describe('ProviderManager', () => {
  it('идёт по цепочке: ошибка → пусто → найдено; остальных не трогает', async () => {
    const a = fake('a', async () => {
      throw new Error('down');
    });
    const b = fake('b', async () => null);
    const c = fake('c', async () => hls('https://c.example/m.m3u8'));
    const d = fake('d', async () => hls('https://d.example/m.m3u8'));
    const m = new ProviderManager([a.provider, b.provider, c.provider, d.provider]);

    const r = await m.resolveWithFallback(movie);
    assert.equal(r.providerId, 'c');
    assert.deepEqual(r.providers.map((p) => p.status), ['error', 'empty', 'ok', 'untried']);
    assert.equal(d.calls(), 0);
  });

  it('preferred ставит источник первым, exclude пропускает', async () => {
    const a = fake('a', async () => hls('https://a.example/m.m3u8'));
    const b = fake('b', async () => hls('https://b.example/m.m3u8'));
    const m = new ProviderManager([a.provider, b.provider]);
    assert.equal((await m.resolveWithFallback(movie, { preferred: 'b' })).providerId, 'b');
    assert.equal((await m.resolveWithFallback(movie, { exclude: ['a'] })).providerId, 'b');
    assert.equal((await m.resolveWithFallback(movie, { exclude: ['a', 'b'] })).providerId, null);
  });

  it('таймаут провайдера не держит цепочку', async () => {
    const slow = fake('slow', () => new Promise(() => {}));
    const fast = fake('fast', async () => hls('https://f.example/m.m3u8'));
    const m = new ProviderManager([slow.provider, fast.provider], { timeoutMs: 50 });
    const r = await m.resolveWithFallback(movie);
    assert.equal(r.providerId, 'fast');
    assert.equal(r.providers[0]!.status, 'timeout');
  });

  it('кэширует ответы и отбрасывает невалидные ссылки', async () => {
    const a = fake('a', async () => [
      { url: 'javascript:alert(1)', type: 'hls' },
      { url: 'https://ok.example/v.mp4', type: 'mp4' },
      { url: 'https://ok.example/x', type: 'flv' as never },
    ]);
    const m = new ProviderManager([a.provider]);
    const r1 = await m.resolveWithFallback(movie);
    await m.resolveWithFallback(movie);
    assert.deepEqual(r1.streams.map((s) => s.url), ['https://ok.example/v.mp4']);
    assert.equal(a.calls(), 1);
  });

  it('запрещает дубли id', () => {
    const a = fake('a', async () => null);
    assert.throws(() => new ProviderManager([a.provider, a.provider]));
  });
});

describe('GenericHttpProvider', () => {
  const srv = mockServer((_req, res, url) => {
    if (url.pathname === '/missing') return json(res, { error: 'nope' }, 404);
    if (url.pathname === '/broken') return json(res, {}, 500);
    if (url.pathname === '/nested') {
      return json(res, {
        data: { items: [{ src: '/v/1080.mp4', q: '1080p', audio: 'Дубляж' }, { src: 'https://cdn.example/m.m3u8' }, { src: '/v/sub.vtt' }] },
      });
    }
    json(res, { streams: [{ url: 'https://cdn.example/master.m3u8', type: 'hls', label: 'Оригинал' }] });
  });
  let origin = '';
  before(async () => (origin = await srv.start()));
  after(() => srv.stop());

  it('подставляет параметры и выкидывает пустые', () => {
    const u = buildEndpoint('http://x.local/s?tmdb={tmdbId}&imdb={imdbId}&s={season}&e={episode}&q={title}', movie);
    assert.equal(u, 'http://x.local/s?tmdb=603&imdb=tt0133093&q=%D0%9C%D0%B0%D1%82%D1%80%D0%B8%D1%86%D0%B0');
  });

  it('разбирает формат по умолчанию', async () => {
    const p = new GenericHttpProvider({ type: 'http', id: 'h', name: 'H', endpointUrl: `${origin}/streams?tmdb={tmdbId}` });
    assert.deepEqual(await p.resolveMedia(movie), [{ url: 'https://cdn.example/master.m3u8', type: 'hls', quality: undefined, label: 'Оригинал', referer: undefined }]);
    assert.equal(srv.seen.at(-1)?.searchParams.get('tmdb'), '603');
  });

  it('itemsPath + fields, относительные URL, тип по расширению', async () => {
    const p = new GenericHttpProvider({
      type: 'http',
      id: 'h',
      name: 'H',
      endpointUrl: `${origin}/nested`,
      itemsPath: 'data.items',
      fields: { url: 'src', quality: 'q', label: 'audio' },
    });
    const r = await p.resolveMedia(movie);
    assert.deepEqual(r?.map((s) => [s.url, s.type, s.quality, s.label]), [
      [`${origin}/v/1080.mp4`, 'mp4', '1080p', 'Дубляж'],
      ['https://cdn.example/m.m3u8', 'hls', undefined, undefined],
    ]);
  });

  it('404 → null, 5xx → исключение (для статуса в UI)', async () => {
    assert.equal(await new GenericHttpProvider({ type: 'http', id: 'h', name: 'H', endpointUrl: `${origin}/missing` }).resolveMedia(movie), null);
    await assert.rejects(new GenericHttpProvider({ type: 'http', id: 'h', name: 'H', endpointUrl: `${origin}/broken` }).resolveMedia(movie));
  });
});

describe('JellyfinProvider', () => {
  const media = (id: string, container = 'mkv', codec = 'hevc') => ({
    Id: id,
    Container: container,
    MediaStreams: [
      { Type: 'Video', Index: 0, Codec: codec },
      { Type: 'Audio', Index: 1, Title: 'Дубляж', Language: 'rus' },
      { Type: 'Audio', Index: 2, DisplayTitle: 'English - AAC', Language: 'eng' },
    ],
  });
  const srv = mockServer((req, res, url) => {
    if (!String(req.headers.authorization).includes('Token="0123456789abcdef0123"')) return json(res, {}, 401);
    if (url.pathname === '/Items' && url.searchParams.get('IncludeItemTypes') === 'Movie') {
      return json(res, {
        Items: [
          { Id: 'm1', Name: 'The Matrix', Type: 'Movie', ProductionYear: 1999, ProviderIds: { Tmdb: '603', Imdb: 'tt0133093' } },
          { Id: 'm2', Name: 'Домашнее видео', Type: 'Movie', ProductionYear: 2020, ProviderIds: {} },
        ],
      });
    }
    if (url.pathname === '/Items' && url.searchParams.get('IncludeItemTypes') === 'Series') {
      return json(res, { Items: [{ Id: 's1', Name: 'Тьма', Type: 'Series', ProviderIds: { Tmdb: '70523' } }] });
    }
    if (url.pathname === '/Items' && url.searchParams.get('ids')) {
      const id = url.searchParams.get('ids')!;
      return json(res, { Items: [{ Id: id, Name: 'x', Type: 'Movie', MediaSources: [media(id, id === 'm2' ? 'mp4' : 'mkv', id === 'm2' ? 'h264' : 'hevc')] }] });
    }
    if (url.pathname === '/Shows/s1/Episodes') {
      const season = Number(url.searchParams.get('season'));
      return json(res, {
        Items: [1, 2].map((e) => ({ Id: `e${season}${e}`, Name: `E${e}`, Type: 'Episode', ParentIndexNumber: season, IndexNumber: e, MediaSources: [media(`e${season}${e}`)] })),
      });
    }
    json(res, {}, 404);
  });
  let jf: JellyfinProvider;
  before(async () => {
    const origin = await srv.start();
    jf = new JellyfinProvider({ type: 'jellyfin', id: 'jellyfin', name: 'Jellyfin', baseUrl: origin, apiKey: '0123456789abcdef0123', directPlay: true });
  });
  after(() => srv.stop());

  it('находит фильм по TMDB ID: дорожки → озвучки, профили → качества', async () => {
    const r = (await jf.resolveMedia(movie))!;
    assert.deepEqual([...new Set(r.map((s) => s.label))], ['Дубляж', 'English - AAC']);
    assert.deepEqual(r.filter((s) => s.label === 'Дубляж').map((s) => s.quality), ['Авто', '1080p', '720p', '480p', '360p']);
    const u = new URL(r.find((s) => s.quality === '720p' && s.label === 'Дубляж')!.url);
    assert.equal(u.pathname, '/Videos/m1/master.m3u8');
    assert.equal(u.searchParams.get('AudioStreamIndex'), '1');
    assert.equal(u.searchParams.get('MaxHeight'), '720');
    assert.equal(u.searchParams.get('MediaSourceId'), 'm1');
    assert.ok(!r.some((s) => s.type === 'mp4'), 'HEVC/MKV не отдаём как direct play');
  });

  it('фоллбек по названию + direct play для H.264/MP4', async () => {
    const r = (await jf.resolveMedia({ kind: 'movie', tmdbId: 999, title: 'Домашнее  видео!', year: 2021 }))!;
    const direct = r.find((s) => s.type === 'mp4');
    assert.equal(new URL(direct!.url).pathname, '/Videos/m2/stream');
  });

  it('сериал: сезон и серия', async () => {
    const r = (await jf.resolveMedia({ kind: 'tv', tmdbId: 70523, season: 2, episode: 1 }))!;
    assert.ok(r[0]!.url.includes('/Videos/e21/master.m3u8'));
    assert.equal(await jf.resolveMedia({ kind: 'tv', tmdbId: 70523, season: 2, episode: 9 }), null);
  });

  it('нет в библиотеке → null; индекс кэшируется', async () => {
    const before = srv.seen.filter((u) => u.searchParams.get('IncludeItemTypes') === 'Movie').length;
    assert.equal(await jf.resolveMedia({ kind: 'movie', tmdbId: 1, title: 'Нет такого' }), null);
    assert.equal(srv.seen.filter((u) => u.searchParams.get('IncludeItemTypes') === 'Movie').length, before);
  });
});
