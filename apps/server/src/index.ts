import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config } from './config.js';
import { LibraryDb } from './db.js';
import { KinopoiskClient } from './metadata/kinopoisk.js';
import { MetadataService } from './metadata/service.js';
import { TmdbClient } from './metadata/tmdb.js';
import { registerApiRoutes } from './routes/api.js';
import { createSocketServer } from './socket/server.js';
import { DemoProvider } from './streaming/providers/demo.js';
import { LibraryProvider } from './streaming/providers/library.js';
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
const providers = [new LibraryProvider(config.libraryPath, config.extractorAllowedHosts), new DemoProvider()];

registerApiRoutes(app, meta, db);
registerStreamingRoutes(app, signer, providers);

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
app.log.info(`metadata: ${meta.mode}; providers: ${providers.map((p) => p.id).join(', ')}`);
