import { DEFAULT_AD_PATTERNS } from './hls-cleaner.js';

/**
 * Универсальный экстрактор потоков со страницы embed-плеера.
 *
 * Принцип: чужой HTML никогда не отдаётся в браузер TV. Сервер скачивает страницу,
 * вынимает из неё только прямые ссылки на `.m3u8`/`.mp4` и выбрасывает всё
 * остальное — скрипты, iframe-ы, pop-under, VAST-теги, майнеры. Клиент получает
 * чистый манифест, который дальше идёт через `hls-cleaner`.
 *
 * Разбираются распространённые открытые форматы:
 *  - `<video src>`, `<source src>`, `data-src`/`data-file`;
 *  - JSON/JS-конфиги плееров (`"file": "..."`, `"hls": "..."`, `sources: [{src}]`) в т.ч. с `\/`;
 *  - строка качеств Playerjs: `[1080p]url1,[720p]url2` и список озвучек `[{"title","file"}]`;
 *  - вложенный `<iframe src>` — возвращается как кандидат для следующего шага (только allowlist).
 *
 * Специфичные обфускации конкретных сайтов сюда сознательно не входят: источник
 * подключается через провайдер (см. providers/), который вы настраиваете сами.
 */

export interface ExtractedStream {
  url: string;
  type: 'hls' | 'mp4';
  quality?: string;
  height?: number;
  voice?: string;
}

export interface ExtractResult {
  streams: ExtractedStream[];
  iframes: string[];
  /** Сколько внешних скриптов/iframe/рекламных ссылок было отброшено. */
  discarded: { scripts: number; iframes: number; adUrls: number };
}

const MEDIA_URL = /(?:https?:)?\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
const QUALITY_LIST = /\[(\d{3,4}p?|4K|2K|HD|SD)\]\s*((?:https?:)?\/\/[^,\s"'\]]+)/gi;
const MEDIA_ATTR = /<(?:video|source)\b[^>]*?\b(?:data-)?(?:src|file)\s*=\s*["']([^"']+)["']/gi;
const IFRAME = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
const SCRIPT_SRC = /<script\b[^>]*\bsrc\s*=/gi;
const VOICE_BLOCK = /\{\s*"title"\s*:\s*"([^"]{1,80})"\s*,\s*"file"\s*:\s*"([^"]+)"/g;

const unescapeJs = (s: string) =>
  s
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&');

function heightOf(label: string | undefined): number | undefined {
  if (!label) return undefined;
  if (/4K/i.test(label)) return 2160;
  if (/2K/i.test(label)) return 1440;
  const n = /(\d{3,4})/.exec(label)?.[1];
  return n ? Number(n) : undefined;
}

function absolutize(u: string, base: string): string | null {
  try {
    const url = new URL(u.startsWith('//') ? `https:${u}` : u, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function extractStreams(html: string, pageUrl: string): ExtractResult {
  const text = unescapeJs(html);
  const isAd = (u: string) => DEFAULT_AD_PATTERNS.some((p) => p.test(u));
  const byUrl = new Map<string, ExtractedStream>();
  let adUrls = 0;

  const add = (raw: string, extra: Partial<ExtractedStream> = {}) => {
    const url = absolutize(raw.trim(), pageUrl);
    if (!url) return;
    if (isAd(url)) {
      adUrls++;
      return;
    }
    const type = /\.m3u8$/i.test(new URL(url).pathname) ? 'hls' : 'mp4';
    const prev = byUrl.get(url);
    byUrl.set(url, { url, type, ...prev, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) });
  };

  // Озвучки Playerjs: [{"title":"Дубляж","file":"[1080p]..,[720p].."}]
  for (const m of text.matchAll(VOICE_BLOCK)) {
    const [, voice, file] = m;
    const qualities = [...file!.matchAll(QUALITY_LIST)];
    if (qualities.length) for (const q of qualities) add(q[2]!, { voice, quality: q[1], height: heightOf(q[1]) });
    else add(file!, { voice });
  }
  // Списки качеств без озвучки.
  for (const q of text.matchAll(QUALITY_LIST)) add(q[2]!, { quality: q[1], height: heightOf(q[1]) });
  // <video>/<source> — в т.ч. с относительными путями.
  for (const m of text.matchAll(MEDIA_ATTR)) add(m[1]!);
  // Любые прямые ссылки на медиа.
  for (const m of text.matchAll(MEDIA_URL)) add(m[0]);

  const iframes: string[] = [];
  let iframeCount = 0;
  for (const m of html.matchAll(IFRAME)) {
    iframeCount++;
    const url = absolutize(unescapeJs(m[1]!), pageUrl);
    if (url && !isAd(url)) iframes.push(url);
  }

  return {
    streams: [...byUrl.values()].sort((a, b) => (b.height ?? 0) - (a.height ?? 0)),
    iframes,
    discarded: { scripts: (html.match(SCRIPT_SRC) ?? []).length, iframes: iframeCount, adUrls },
  };
}
