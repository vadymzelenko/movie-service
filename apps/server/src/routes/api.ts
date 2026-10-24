import { networkInterfaces } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  catalogQuerySchema,
  listNameSchema,
  mediaKindSchema,
  parseMediaKey,
  progressUpdateSchema,
  type TitleSummary,
} from '@movie/shared';
import type { LibraryDb } from '../db.js';
import type { MetadataService } from '../metadata/service.js';

const titleParams = z.object({ kind: mediaKindSchema, id: z.coerce.number().int() });
const seasonParams = z.object({ id: z.coerce.number().int(), season: z.coerce.number().int().min(0) });
const keyParams = z.object({ key: z.string().max(64) });
const listParams = z.object({ list: listNameSchema, kind: mediaKindSchema, id: z.coerce.number().int() });

const summarySchema: z.ZodType<TitleSummary> = z.object({
  kind: mediaKindSchema,
  id: z.number().int(),
  title: z.string().max(300),
  originalTitle: z.string().max(300).optional(),
  year: z.number().int().optional(),
  posterUrl: z.url().optional(),
  backdropUrl: z.url().optional(),
  overview: z.string().max(5000).optional(),
  genreIds: z.array(z.number().int()).max(20),
  ratings: z.object({ imdb: z.number().optional(), kinopoisk: z.number().optional(), tmdb: z.number().optional() }),
});

/** IPv4-адреса машины в локальной сети — TV строит из них QR, если открыт по localhost. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

export function registerApiRoutes(app: FastifyInstance, meta: MetadataService, db: LibraryDb) {
  app.get('/api/health', async () => ({ ok: true, metadata: meta.mode }));
  app.get('/api/network', async () => ({ addresses: lanAddresses() }));

  // ---- Каталог ------------------------------------------------------------

  app.get('/api/catalog', async (req, reply) => {
    const q = catalogQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    return meta.catalog(q.data);
  });

  app.get('/api/search', async (req, reply) => {
    const q = z.object({ q: z.string().trim().min(1).max(200) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    return meta.search(q.data.q);
  });

  app.get('/api/genres/:kind', async (req, reply) => {
    const p = z.object({ kind: mediaKindSchema }).safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_params' });
    return meta.genres(p.data.kind);
  });

  app.get('/api/title/:kind/:id', async (req, reply) => {
    const p = titleParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_params' });
    const details = await meta.details(p.data.kind, p.data.id);
    if (!details) return reply.code(404).send({ error: 'not_found' });
    return details;
  });

  app.get('/api/title/:kind/:id/reviews', async (req, reply) => {
    const p = titleParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_params' });
    const details = await meta.details(p.data.kind, p.data.id);
    if (!details) return reply.code(404).send({ error: 'not_found' });
    return meta.reviews(details);
  });

  app.get('/api/tv/:id/season/:season', async (req, reply) => {
    const p = seasonParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_params' });
    return meta.episodes(p.data.id, p.data.season);
  });

  // ---- Прогресс просмотра ---------------------------------------------------

  app.get('/api/progress', async () => db.listProgress());

  app.get('/api/progress/title/:kind/:id', async (req, reply) => {
    const p = titleParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_params' });
    return db.progressForTitle(p.data.kind, p.data.id);
  });

  // POST — для navigator.sendBeacon при закрытии плеера/вкладки (он умеет только POST + text/plain).
  app.route({
    method: ['PUT', 'POST'],
    url: '/api/progress/:key',
    handler: async (req, reply) => {
      const p = keyParams.safeParse(req.params);
      let raw: unknown = req.body;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          raw = null;
        }
      }
      const body = progressUpdateSchema.safeParse(raw);
      if (!p.success || !body.success || !parseMediaKey(p.data.key)) return reply.code(400).send({ error: 'invalid_payload' });
      return db.saveProgress(p.data.key, body.data);
    },
  });

  app.delete('/api/progress/:key', async (req, reply) => {
    const p = keyParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_params' });
    db.deleteProgress(p.data.key);
    return reply.code(204).send();
  });

  // ---- Избранное / «Посмотреть позже» ---------------------------------------

  app.get('/api/lists', async () => db.getLists());

  app.put('/api/lists/:list/:kind/:id', async (req, reply) => {
    const p = listParams.safeParse(req.params);
    const body = summarySchema.safeParse(req.body);
    if (!p.success || !body.success || body.data.id !== p.data.id || body.data.kind !== p.data.kind) {
      return reply.code(400).send({ error: 'invalid_payload' });
    }
    db.addToList(p.data.list, body.data);
    return reply.code(204).send();
  });

  app.delete('/api/lists/:list/:kind/:id', async (req, reply) => {
    const p = listParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_params' });
    db.removeFromList(p.data.list, p.data.kind, p.data.id);
    return reply.code(204).send();
  });
}
