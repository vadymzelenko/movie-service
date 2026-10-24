import type { MediaRef } from '@movie/shared';

/** Источник в «сыром» виде — с upstream-URL, до подписи прокси-ссылок. */
export interface RawSource {
  voice: string;
  type: 'hls' | 'mp4';
  qualities: { label: string; height?: number; url: string }[];
  /** Referer, который требует CDN источника. */
  referer?: string;
}

/**
 * Провайдер потоков. Подключение нового источника = новый класс с этим интерфейсом
 * в `providers/` + регистрация в `index.ts`.
 */
export interface StreamProvider {
  readonly id: string;
  readonly name: string;
  resolve(media: MediaRef): Promise<RawSource[]>;
}
