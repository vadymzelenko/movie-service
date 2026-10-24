import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanPlaylist, parseVariants } from '../src/streaming/hls-cleaner.js';

const rewrite = (u: string, kind: string) => `P[${kind}]${u}`;
const opts = (baseUrl = 'https://cdn.example.com/movie/hls/720/index.m3u8') => ({ baseUrl, rewrite });

const segs = (n: number, prefix: string, dur = 6) =>
  Array.from({ length: n }, (_, i) => `#EXTINF:${dur.toFixed(3)},\n${prefix}${i}.ts`).join('\n');

const uris = (body: string) => body.split('\n').filter((l) => l && !l.startsWith('#'));

describe('cleanPlaylist: media', () => {
  it('вырезает рекламный блок с чужого хоста и схлопывает discontinuity', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:0',
      segs(10, 'seg'),
      '#EXT-X-DISCONTINUITY',
      segs(3, 'https://adserver.net/clip/', 5),
      '#EXT-X-DISCONTINUITY',
      segs(10, 'seg_b'),
      '#EXT-X-ENDLIST',
    ].join('\n');

    const r = cleanPlaylist(text, opts());
    assert.equal(r.type, 'media');
    assert.equal(r.removedSegments, 3);
    assert.equal(r.removedSeconds, 15);
    assert.deepEqual(r.reasons, ['foreign-host']);
    assert.equal(uris(r.body).length, 20);
    assert.ok(!r.body.includes('adserver.net'));
    assert.equal(r.body.match(/#EXT-X-DISCONTINUITY/g)?.length, 1);
    assert.ok(r.body.trimEnd().endsWith('#EXT-X-ENDLIST'));
    assert.ok(uris(r.body)[0]!.startsWith('P[segment]https://cdn.example.com/movie/hls/720/seg0.ts'));
  });

  it('вырезает прероллы по URL-паттерну и сдвигает MEDIA-SEQUENCE', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:100',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      segs(2, '/ads/preroll_'),
      '#EXT-X-DISCONTINUITY',
      segs(5, 'seg'),
      '#EXT-X-ENDLIST',
    ].join('\n');
    const r = cleanPlaylist(text, opts());
    assert.equal(r.removedSegments, 2);
    assert.ok(r.body.includes('#EXT-X-MEDIA-SEQUENCE:102'));
    assert.ok(!r.body.includes('#EXT-X-DISCONTINUITY\n'), 'ведущая discontinuity не нужна');
  });

  it('удаляет SCTE-35 CUE-OUT/CUE-IN', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      segs(3, 'a'),
      '#EXT-X-CUE-OUT:DURATION=12',
      segs(2, 'b'),
      '#EXT-X-CUE-OUT-CONT:ElapsedTime=6,Duration=12',
      '#EXT-X-CUE-IN',
      segs(3, 'c'),
      '#EXT-X-ENDLIST',
    ].join('\n');
    const r = cleanPlaylist(text, opts());
    assert.deepEqual(r.reasons, ['scte35']);
    assert.equal(r.removedSegments, 2);
    assert.ok(!r.body.includes('CUE'));
  });

  it('ловит блок с другим шаблоном пути на том же хосте', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      segs(20, '/movie/hls/720/s'),
      '#EXT-X-DISCONTINUITY',
      segs(4, '/x9/c/', 4),
      '#EXT-X-DISCONTINUITY',
      segs(20, '/movie/hls/720/t'),
      '#EXT-X-ENDLIST',
    ].join('\n');
    const r = cleanPlaylist(text, opts());
    assert.deepEqual(r.reasons, ['path-signature']);
    assert.equal(r.removedSegments, 4);
  });

  it('не трогает легитимные discontinuity (заставки одного источника)', () => {
    const text = ['#EXTM3U', '#EXT-X-TARGETDURATION:6', segs(5, 'a'), '#EXT-X-DISCONTINUITY', segs(5, 'b'), '#EXT-X-ENDLIST'].join('\n');
    const r = cleanPlaylist(text, opts());
    assert.equal(r.removedSegments, 0);
    assert.equal(r.body.match(/#EXT-X-DISCONTINUITY/g)?.length, 1);
  });

  it('предохранитель: эвристики не съедают больше половины', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      segs(2, 'https://a.com/x/'),
      '#EXT-X-DISCONTINUITY',
      segs(2, 'https://b.com/y/'),
      '#EXT-X-DISCONTINUITY',
      segs(2, 'https://c.com/z/'),
      '#EXT-X-ENDLIST',
    ].join('\n');
    assert.equal(cleanPlaylist(text, opts()).removedSegments, 0);
  });

  it('переносит EXT-X-KEY, если удалён сегмент, на котором он объявлен', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXTINF:6,',
      '/ads/a0.ts',
      '#EXT-X-DISCONTINUITY',
      segs(3, 'seg'),
      '#EXT-X-ENDLIST',
    ].join('\n');
    const r = cleanPlaylist(text, opts());
    assert.equal(r.removedSegments, 1);
    assert.match(r.body, /#EXT-X-KEY:METHOD=AES-128,URI="P\[key\]https:\/\/cdn\.example\.com\/movie\/hls\/720\/key\.bin"\n#EXTINF/);
  });

  it('live: вырезает только ведущую рекламу', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:7',
      segs(1, '/ads/x'),
      '#EXT-X-DISCONTINUITY',
      segs(3, 'seg'),
      '#EXT-X-DISCONTINUITY',
      segs(1, '/ads/y'),
    ].join('\n');
    const r = cleanPlaylist(text, opts());
    assert.equal(r.removedSegments, 1);
    assert.ok(r.body.includes('#EXT-X-MEDIA-SEQUENCE:8'));
    assert.ok(r.body.includes('/ads/y0.ts'));
  });

  it('удаляет HLS interstitials', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-DATERANGE:ID="ad1",CLASS="com.apple.hls.interstitial",START-DATE="2024-01-01T00:00:10Z",X-ASSET-URI="https://ads/x.m3u8"',
      segs(3, 'a'),
      '#EXT-X-ENDLIST',
    ].join('\n');
    const r = cleanPlaylist(text, opts());
    assert.ok(!r.body.includes('interstitial'));
    assert.deepEqual(r.reasons, ['interstitial']);
  });
});

describe('cleanPlaylist: master', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Дубляж",LANGUAGE="ru",URI="audio/ru.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="aud"',
    '1080/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,AUDIO="aud"',
    '720/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=640x360',
    'https://ads.example.org/promo/stream.m3u8',
  ].join('\n');

  it('переписывает варианты и аудиодорожки, выкидывает рекламные варианты', () => {
    const r = cleanPlaylist(master, opts('https://cdn.example.com/movie/master.m3u8'));
    assert.equal(r.type, 'master');
    assert.ok(r.body.includes('URI="P[playlist]https://cdn.example.com/movie/audio/ru.m3u8"'));
    assert.ok(r.body.includes('P[playlist]https://cdn.example.com/movie/1080/index.m3u8'));
    assert.ok(!r.body.includes('promo'));
    assert.equal(r.reasons.length, 1);
  });

  it('parseVariants отдаёт высоту и битрейт', () => {
    const v = parseVariants(master, 'https://cdn.example.com/movie/master.m3u8');
    assert.equal(v[0]?.height, 1080);
    assert.equal(v[1]?.bandwidth, 2500000);
  });

  it('отвергает не-HLS', () => {
    assert.throws(() => cleanPlaylist('<html>', opts()));
  });
});
