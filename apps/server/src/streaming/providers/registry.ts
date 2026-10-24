import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { DemoProvider } from './demo.js';
import { GenericHttpProvider, genericHttpConfigSchema } from './generic-http.js';
import { JellyfinProvider, jellyfinConfigSchema } from './jellyfin.js';
import { LibraryProvider } from './library.js';
import type { StreamProvider } from './types.js';

const fileSchema = z.object({
  /** Порядок = приоритет в цепочке фоллбеков. */
  providers: z.array(z.discriminatedUnion('type', [jellyfinConfigSchema, genericHttpConfigSchema])).default([]),
  /** Ручная медиатека library.json — первой: явное сопоставление важнее автоматического. */
  includeLibrary: z.boolean().default(true),
  /** Демо-потоки — последними, как запасной вариант для проверки. */
  includeDemo: z.boolean().default(true),
});

export interface RegistryOptions {
  providersPath: string;
  libraryPath: string;
  extractorAllowedHosts: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * Собирает цепочку провайдеров из `data/providers.json` (+ быстрый старт Jellyfin через
 * JELLYFIN_URL / JELLYFIN_API_KEY). Ошибка в конфиге — исключение при старте, а не тихий пропуск.
 */
export function buildProviders(opts: RegistryOptions): StreamProvider[] {
  const raw: unknown = existsSync(opts.providersPath) ? JSON.parse(readFileSync(opts.providersPath, 'utf8')) : {};
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`providers.json: ${z.prettifyError(parsed.error)}`);
  const cfg = parsed.data;

  const configured: StreamProvider[] = cfg.providers.map((p) => (p.type === 'jellyfin' ? new JellyfinProvider(p) : new GenericHttpProvider(p)));

  const { JELLYFIN_URL, JELLYFIN_API_KEY, JELLYFIN_USER_ID } = opts.env;
  if (JELLYFIN_URL && JELLYFIN_API_KEY && !configured.some((p) => p.id === 'jellyfin')) {
    configured.unshift(
      new JellyfinProvider(jellyfinConfigSchema.parse({ type: 'jellyfin', baseUrl: JELLYFIN_URL, apiKey: JELLYFIN_API_KEY, userId: JELLYFIN_USER_ID || undefined })),
    );
  }

  return [
    ...(cfg.includeLibrary ? [new LibraryProvider(opts.libraryPath, opts.extractorAllowedHosts)] : []),
    ...configured,
    ...(cfg.includeDemo ? [new DemoProvider()] : []),
  ];
}
