/**
 * Очистка HLS-плейлистов от рекламных вставок.
 *
 * Как реклама попадает в HLS. Балансеры «вшивают» ролики прямо в media-плейлист
 * (server-side ad insertion): между сегментами фильма появляются блоки,
 * отделённые `#EXT-X-DISCONTINUITY` (у рекламы другие таймстемпы/кодек).
 * Признаки такого блока, которые мы используем (от надёжных к эвристическим):
 *
 *  1. Явная разметка SCTE-35: `#EXT-X-CUE-OUT` … `#EXT-X-CUE-IN`.
 *  2. URL сегмента похож на рекламный: `/ads/`, `/promo/`, `vast`, `preroll`, …
 *  3. Короткий discontinuity-блок, отданный с другого хоста, чем основной контент.
 *  4. Короткий discontinuity-блок с другим «шаблоном пути» на том же хосте.
 *
 * Плюс удаляются `EXT-X-DATERANGE` с HLS Interstitials (рекламные «вставки-ссылки»).
 * Предохранитель: если «рекламой» оказалось больше половины длительности —
 * эвристики 3–4 считаются ошибочными и не применяются.
 *
 * Модуль чистый (без I/O) — легко покрывается тестами, см. test/hls-cleaner.test.ts.
 */

export type UriKind = 'playlist' | 'segment' | 'key' | 'map';

export interface CleanOptions {
  /** URL, с которого скачан плейлист — для разрешения относительных путей. */
  baseUrl: string;
  /** Как переписывать URL (обычно — на подписанный адрес нашего прокси). */
  rewrite: (absoluteUrl: string, kind: UriKind) => string;
  /** Максимальная длина блока, который эвристики 3–4 могут счесть рекламой. */
  maxAdBlockSec?: number;
  /** Дополнительные паттерны рекламных URL. */
  adUrlPatterns?: RegExp[];
}

export interface CleanResult {
  type: 'master' | 'media';
  body: string;
  removedSegments: number;
  removedSeconds: number;
  reasons: string[];
}

export const DEFAULT_AD_PATTERNS: RegExp[] = [
  /[/._-](ads?|adv|advert|adverts|advertising|reklama|promo|commercials?)[/._-]/i,
  /[/._-](vast|vpaid|vmap|preroll|pre-roll|midroll|mid-roll|postroll|bumper)[/._-]/i,
  /[/._-](casino|bet|1xbet|vulkan)[/._-]/i,
];

const URI_ATTR = /URI="([^"]+)"/;

function resolve(uri: string, base: string): string {
  return new URL(uri, base).toString();
}

function rewriteUriAttr(line: string, base: string, kind: UriKind, rewrite: CleanOptions['rewrite']): string {
  return line.replace(URI_ATTR, (_, uri: string) => `URI="${rewrite(resolve(uri, base), kind)}"`);
}

const isInterstitial = (line: string) =>
  line.startsWith('#EXT-X-DATERANGE') && /CLASS="com\.apple\.hls\.interstitial"/.test(line);

// ---------------------------------------------------------------------------
// Master playlist
// ---------------------------------------------------------------------------

function cleanMaster(lines: string[], opts: CleanOptions): CleanResult {
  const out: string[] = [];
  const patterns = [...DEFAULT_AD_PATTERNS, ...(opts.adUrlPatterns ?? [])];
  const reasons: string[] = [];
  let pendingStreamInf: string | null = null;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      pendingStreamInf = line;
      continue;
    }
    if (pendingStreamInf !== null && line && !line.startsWith('#')) {
      const abs = resolve(line, opts.baseUrl);
      if (patterns.some((p) => p.test(abs))) {
        reasons.push(`variant:${new URL(abs).pathname}`);
      } else {
        out.push(pendingStreamInf, opts.rewrite(abs, 'playlist'));
      }
      pendingStreamInf = null;
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF')) {
      out.push(rewriteUriAttr(line, opts.baseUrl, 'playlist', opts.rewrite));
    } else if (line.startsWith('#EXT-X-SESSION-KEY')) {
      out.push(rewriteUriAttr(line, opts.baseUrl, 'key', opts.rewrite));
    } else if (isInterstitial(line)) {
      reasons.push('interstitial');
    } else {
      out.push(line);
    }
  }
  return { type: 'master', body: out.join('\n') + '\n', removedSegments: 0, removedSeconds: 0, reasons };
}

// ---------------------------------------------------------------------------
// Media playlist
// ---------------------------------------------------------------------------

interface Segment {
  uri: string; // абсолютный upstream URL
  duration: number;
  /** Теги, относящиеся только к этому сегменту (EXTINF, BYTERANGE, PROGRAM-DATE-TIME…). */
  tags: string[];
  /** Действующие на момент сегмента EXT-X-KEY / EXT-X-MAP (уже переписанные). */
  key: string | null;
  map: string | null;
  discontinuityBefore: boolean;
  block: number;
  inCue: boolean;
  ad: string | null;
}

const hostOf = (u: string) => new URL(u).host;

/** Шаблон пути: каталог сегмента с цифрами, заменёнными на «#». */
function pathSignature(u: string): string {
  const p = new URL(u).pathname;
  return p.slice(0, p.lastIndexOf('/') + 1).replace(/\d+/g, '#');
}

function dominant(segs: Segment[], keyOf: (s: Segment) => string): string | null {
  const totals = new Map<string, number>();
  for (const s of segs) totals.set(keyOf(s), (totals.get(keyOf(s)) ?? 0) + s.duration);
  let best: string | null = null;
  let bestSec = -1;
  for (const [k, sec] of totals) if (sec > bestSec) [best, bestSec] = [k, sec];
  return best;
}

function cleanMedia(lines: string[], opts: CleanOptions): CleanResult {
  const maxAdBlockSec = opts.maxAdBlockSec ?? 90;
  const patterns = [...DEFAULT_AD_PATTERNS, ...(opts.adUrlPatterns ?? [])];
  const header: string[] = [];
  const trailer: string[] = [];
  const segments: Segment[] = [];
  const reasons = new Set<string>();

  let tags: string[] = [];
  let duration = 0;
  let key: string | null = null;
  let map: string | null = null;
  let discontinuity = false;
  let block = 0;
  let inCue = false;
  let seenSegment = false;
  const isLive = !lines.some((l) => l.startsWith('#EXT-X-ENDLIST') || l === '#EXT-X-PLAYLIST-TYPE:VOD');

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      duration = parseFloat(line.slice(8));
      tags.push(line);
    } else if (line.startsWith('#EXT-X-KEY')) {
      key = /METHOD=NONE/.test(line) ? line : rewriteUriAttr(line, opts.baseUrl, 'key', opts.rewrite);
    } else if (line.startsWith('#EXT-X-MAP')) {
      map = rewriteUriAttr(line, opts.baseUrl, 'map', opts.rewrite);
    } else if (line === '#EXT-X-DISCONTINUITY') {
      discontinuity = true;
    } else if (line.startsWith('#EXT-X-CUE-OUT') && !line.startsWith('#EXT-X-CUE-OUT-CONT')) {
      inCue = true;
    } else if (line.startsWith('#EXT-X-CUE-IN')) {
      inCue = false;
    } else if (line.startsWith('#EXT-X-CUE-OUT-CONT') || line.startsWith('#EXT-OATCLS-SCTE35') || line.startsWith('#EXT-X-ASSET')) {
      // Служебная SCTE-разметка: после вырезания рекламы она не нужна.
    } else if (isInterstitial(line)) {
      reasons.add('interstitial');
    } else if (line === '#EXT-X-ENDLIST') {
      trailer.push(line);
    } else if (line.startsWith('#')) {
      // Теги до первого сегмента — заголовок, после — относятся к следующему сегменту.
      if (!seenSegment && tags.length === 0 && !line.startsWith('#EXT-X-PROGRAM-DATE-TIME') && !line.startsWith('#EXT-X-BYTERANGE')) {
        header.push(line);
      } else {
        tags.push(line);
      }
    } else {
      if (discontinuity && seenSegment) block++;
      segments.push({
        uri: resolve(line, opts.baseUrl),
        duration: Number.isFinite(duration) ? duration : 0,
        tags,
        key,
        map,
        discontinuityBefore: discontinuity,
        block,
        inCue,
        ad: null,
      });
      seenSegment = true;
      tags = [];
      duration = 0;
      discontinuity = false;
    }
  }

  // --- 1–2: надёжные признаки ---------------------------------------------
  for (const s of segments) {
    if (s.inCue) s.ad = 'scte35';
    else if (patterns.some((p) => p.test(s.uri))) s.ad = 'url-pattern';
  }

  // --- 3–4: эвристики по discontinuity-блокам --------------------------------
  const blocks = new Map<number, Segment[]>();
  for (const s of segments) blocks.set(s.block, [...(blocks.get(s.block) ?? []), s]);

  if (blocks.size > 1) {
    const mainHost = dominant(segments, (s) => hostOf(s.uri));
    const mainSig = dominant(segments, (s) => `${hostOf(s.uri)}${pathSignature(s.uri)}`);
    const total = segments.reduce((a, s) => a + s.duration, 0);
    const candidates: Segment[][] = [];

    for (const segs of blocks.values()) {
      const sec = segs.reduce((a, s) => a + s.duration, 0);
      if (sec > maxAdBlockSec || segs.every((s) => s.ad)) continue;
      // URL-паттерн у большинства сегментов → весь блок реклама.
      if (segs.filter((s) => s.ad === 'url-pattern').length * 2 > segs.length) {
        for (const s of segs) s.ad ??= 'url-pattern';
        continue;
      }
      if (segs.every((s) => hostOf(s.uri) !== mainHost)) candidates.push(segs.map((s) => ((s.ad ??= 'foreign-host'), s)));
      else if (segs.every((s) => `${hostOf(s.uri)}${pathSignature(s.uri)}` !== mainSig))
        candidates.push(segs.map((s) => ((s.ad ??= 'path-signature'), s)));
    }

    // Предохранитель: эвристики не имеют права «съесть» основной контент.
    const heuristicSec = candidates.flat().reduce((a, s) => a + s.duration, 0);
    if (heuristicSec * 2 > total) {
      for (const s of candidates.flat()) if (s.ad === 'foreign-host' || s.ad === 'path-signature') s.ad = null;
    }
  }

  // Для live-плейлиста вырезание из середины ломает нумерацию MEDIA-SEQUENCE
  // между обновлениями, поэтому там убираем только ведущие рекламные сегменты.
  if (isLive) {
    let leading = true;
    for (const s of segments) {
      if (!s.ad) leading = false;
      else if (!leading) s.ad = null;
    }
  }

  // --- Сборка результата ---------------------------------------------------
  const out: string[] = [];
  let removedLeading = 0;
  let droppedLeadingDiscontinuities = 0;
  let emitted = 0;
  let removedSeconds = 0;
  let pendingDiscontinuity = false;
  let lastKey: string | null = null;
  let lastMap: string | null = null;

  for (const s of segments) {
    if (s.ad) {
      reasons.add(s.ad);
      removedSeconds += s.duration;
      if (emitted === 0) {
        removedLeading++;
        if (s.discontinuityBefore) droppedLeadingDiscontinuities++;
      } else if (s.discontinuityBefore) {
        pendingDiscontinuity = true;
      }
      continue;
    }
    if (emitted === 0 && s.discontinuityBefore) {
      // Discontinuity перед первым сегментом бессмысленна, но учитывается в DISCONTINUITY-SEQUENCE.
      droppedLeadingDiscontinuities++;
    } else if (emitted > 0 && (pendingDiscontinuity || s.discontinuityBefore)) {
      out.push('#EXT-X-DISCONTINUITY');
    }
    pendingDiscontinuity = false;
    if (s.key !== lastKey && s.key) out.push(s.key);
    if (s.map !== lastMap && s.map) out.push(s.map);
    lastKey = s.key;
    lastMap = s.map;
    out.push(...s.tags, opts.rewrite(s.uri, 'segment'));
    emitted++;
  }

  const removedSegments = segments.filter((s) => s.ad).length;
  const finalHeader = header.map((line) => {
    if (removedLeading && line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      return `#EXT-X-MEDIA-SEQUENCE:${Number(line.split(':')[1]) + removedLeading}`;
    }
    if (droppedLeadingDiscontinuities && line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) {
      return `#EXT-X-DISCONTINUITY-SEQUENCE:${Number(line.split(':')[1]) + droppedLeadingDiscontinuities}`;
    }
    return line;
  });

  return {
    type: 'media',
    body: [...finalHeader, ...out, ...trailer].join('\n') + '\n',
    removedSegments,
    removedSeconds: Math.round(removedSeconds * 1000) / 1000,
    reasons: [...reasons],
  };
}

export function cleanPlaylist(text: string, opts: CleanOptions): CleanResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== '#EXTM3U') throw new Error('not an HLS playlist');
  return lines.some((l) => l.startsWith('#EXT-X-STREAM-INF')) ? cleanMaster(lines, opts) : cleanMedia(lines, opts);
}

/** Варианты качества из master-плейлиста — для селектора «Качество». */
export function parseVariants(text: string, baseUrl: string): { height?: number; bandwidth: number; url: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const res: { height?: number; bandwidth: number; url: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
    if (!uri) continue;
    const height = /RESOLUTION=\d+x(\d+)/.exec(line)?.[1];
    const bw = /[:,]BANDWIDTH=(\d+)/.exec(line)?.[1];
    res.push({ height: height ? Number(height) : undefined, bandwidth: Number(bw ?? 0), url: resolve(uri, baseUrl) });
  }
  return res;
}
