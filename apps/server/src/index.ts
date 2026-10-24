import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config } from './config.js';
import { LibraryDb } from './db.js';
import { KinopoiskClient } from './metadata/kinopoisk.js';
import { MetadataService } from './metadata/service.js';
import { TmdbClient } from './metadata/tmdb.js';
import { registerApiRoutes } from './routes/api.js';
import { createSocketServer } from './socket/server.js';
import { ProviderManager } from './streaming/provider-manager.js';
import { buildProviders } from './streaming/providers/registry.js';
import { registerStreamingRoutes } from './streaming/routes.js';
import { UrlSigner } from './streaming/signing.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Подписанный токен прокси лежит в пути и бывает длинным.
  maxParamLength: 8192,
});

await app.register(cors, {
  origin: config.corsOrigins.length ? config.corsOrigins : true,
  methods: ['GET', 'PUT', 'POST', 'DELETE'],
});

const db = new LibraryDb(config.dbPath);
const meta = new MetadataService(new TmdbClient(config.tmdbApiKey), new KinopoiskClient(config.kinopoiskApiKey));
const signer = new UrlSigner(config.proxySecret, config.proxyTtlSec);
const providers = buildProviders({
  providersPath: config.providersPath,
  libraryPath: config.libraryPath,
  extractorAllowedHosts: config.extractorAllowedHosts,
  env: process.env,
});
const manager = new ProviderManager(providers, {
  timeoutMs: config.providerTimeoutMs,
  log: (msg, err) => app.log.warn({ err }, msg),
});

registerApiRoutes(app, meta, db);
registerStreamingRoutes(app, signer, manager, async (kind, id) => {
  const d = await meta.details(kind, id);
  return d ? { imdbId: d.imdbId, title: d.title, originalTitle: d.originalTitle, year: d.year } : {};
});

const { io, rooms } = createSocketServer(app.server, {
  corsOrigins: config.corsOrigins,
  roomGraceMs: config.roomGraceMs,
});

const shutdown = async () => {
  rooms.dispose();
  await io.close();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(`metadata: ${meta.mode}; providers (fallback order): ${providers.map((p) => p.id).join(' → ')}`);
