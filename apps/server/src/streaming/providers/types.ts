import type { MediaKind } from '@movie/shared';

/** Что известно о тайтле в момент поиска потока. Провайдер использует то, что умеет сопоставлять. */
export interface ResolveParams {
  kind: MediaKind;
  tmdbId: number;
  imdbId?: string;
  /** Для поиска по названию (Jellyfin, самописные бэкенды без внешних ID). */
  title?: string;
  originalTitle?: string;
  year?: number;
  season?: number;
  episode?: number;
}

/** Один поток, как его отдал провайдер — до подписи прокси-ссылок. */
export interface ProviderStream {
  /** Абсолютный http(s) URL на `.m3u8` или `.mp4`. */
  url: string;
  type: 'hls' | 'mp4';
  /** «1080p», «720p»… Для HLS обычно не задаётся: качества придут из master-плейлиста. */
  quality?: string;
  /** Подпись источника для UI: озвучка, дорожка, «Оригинал». */
  label?: string;
  /** Referer, если CDN его требует. */
  referer?: string;
}

/**
 * Провайдер потоков. Возвращает:
 *  - массив потоков — тайтл найден;
 *  - `null` или `[]` — у провайдера этого тайтла/серии нет (менеджер идёт к следующему);
 *  - исключение — провайдер недоступен (тоже фоллбек, но в UI помечается как ошибка).
 */
export interface StreamProvider {
  readonly id: string;
  readonly name: string;
  resolveMedia(params: ResolveParams, signal?: AbortSignal): Promise<ProviderStream[] | null>;
}
