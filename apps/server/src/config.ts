import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const dataDir = process.env.DATA_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');

function proxySecret(): string {
  const s = process.env.PROXY_SECRET;
  if (s && s !== 'change-me-to-a-long-random-string') return s;
  // Без явного секрета подписи живут до перезапуска — для dev этого достаточно.
  console.warn('[config] PROXY_SECRET не задан — используется случайный секрет на время процесса');
  return randomBytes(32).toString('hex');
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir,
  dbPath: process.env.DB_PATH ?? path.join(dataDir, 'movie-service.db'),
  libraryPath: process.env.LIBRARY_PATH ?? path.join(dataDir, 'library.json'),
  providersPath: process.env.PROVIDERS_PATH ?? path.join(dataDir, 'providers.json'),
  /** Сколько ждём один провайдер, прежде чем перейти к следующему. */
  providerTimeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS ?? 8000),
  proxySecret: proxySecret(),
  /** TTL подписанных прокси-ссылок. Длинный — VOD-плейлист живёт весь сеанс просмотра. */
  proxyTtlSec: 12 * 3600,
  tmdbApiKey: process.env.TMDB_API_KEY ?? '',
  kinopoiskApiKey: process.env.KINOPOISK_API_KEY ?? '',
  corsOrigins: list(process.env.CORS_ORIGINS),
  extractorAllowedHosts: list(process.env.EXTRACTOR_ALLOWED_HOSTS),
  /** Сколько ждём возвращения TV после обрыва, прежде чем закрыть комнату. */
  roomGraceMs: 2 * 60_000,
} as const;

export type AppConfig = typeof config;
