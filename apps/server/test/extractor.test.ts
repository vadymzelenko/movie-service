import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractStreams } from '../src/streaming/extractor.js';
import { UrlSigner } from '../src/streaming/signing.js';

describe('extractStreams', () => {
  const page = 'https://player.example.com/embed/1';

  it('достаёт качества и озвучки Playerjs, отбрасывает скрипты и рекламу', () => {
    const html = `
      <html><head>
        <script src="https://popunder.example/x.js"></script>
        <script src="https://miner.example/m.js"></script>
      </head><body>
        <iframe src="https://ads.example/vast/banner.html"></iframe>
        <script>
          var player = new Playerjs({id:"p", file:[
            {"title":"Дубляж","file":"[1080p]https:\\/\\/cdn.example.com\\/m\\/1080.m3u8,[720p]https:\\/\\/cdn.example.com\\/m\\/720.m3u8"},
            {"title":"LostFilm","file":"[720p]//cdn.example.com/lf/720.m3u8"}
          ], preroll:"https://ads.example.com/vast/preroll.mp4"});
        </script>
      </body></html>`;
    const r = extractStreams(html, page);
    assert.deepEqual(
      r.streams.map((s) => [s.voice, s.height, s.type]),
      [
        ['Дубляж', 1080, 'hls'],
        ['Дубляж', 720, 'hls'],
        ['LostFilm', 720, 'hls'],
      ],
    );
    assert.equal(r.discarded.scripts, 2);
    assert.equal(r.discarded.iframes, 1);
    assert.ok(r.discarded.adUrls >= 1);
    assert.deepEqual(r.iframes, []);
  });

  it('находит <source> и вложенный iframe', () => {
    const html = `<video><source src="/media/film.mp4?t=1" type="video/mp4"></video><iframe src="//inner.example.com/e/2"></iframe>`;
    const r = extractStreams(html, page);
    assert.equal(r.streams[0]?.url, 'https://player.example.com/media/film.mp4?t=1');
    assert.equal(r.streams[0]?.type, 'mp4');
    assert.deepEqual(r.iframes, ['https://inner.example.com/e/2']);
  });
});

describe('UrlSigner', () => {
  const s = new UrlSigner('secret', 60);

  it('подписывает и проверяет', () => {
    const t = s.sign({ u: 'https://cdn.example.com/a.m3u8', r: 'https://player.example.com/' });
    assert.equal(s.verify(t)?.u, 'https://cdn.example.com/a.m3u8');
  });

  it('отвергает подделку и чужой секрет', () => {
    const t = s.sign({ u: 'https://cdn.example.com/a.m3u8' });
    const [payload] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'http://169.254.169.254/', e: 9e9 })).toString('base64url');
    assert.equal(s.verify(`${forged}.${t.split('.')[1]}`), null);
    assert.equal(new UrlSigner('other', 60).verify(t), null);
    assert.equal(s.verify(`${payload}`), null);
  });

  it('отвергает просроченные и не-http ссылки', () => {
    assert.equal(new UrlSigner('k', -10).verify(new UrlSigner('k', -10).sign({ u: 'https://a/b' })), null);
    assert.equal(s.verify(s.sign({ u: 'file:///etc/passwd' })), null);
  });
});
