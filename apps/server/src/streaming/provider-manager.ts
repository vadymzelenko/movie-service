import type { ProviderStream, ResolveParams, StreamProvider } from './providers/types.js';

export type ProviderStatus = 'ok' | 'empty' | 'error' | 'timeout' | 'untried';

export interface ProviderAttempt {
  id: string;
  name: string;
  status: ProviderStatus;
  error?: string;
}

export interface ResolveResult {
  /** Провайдер, чьи потоки отдаются; null — никто не нашёл тайтл. */
  providerId: string | null;
  streams: ProviderStream[];
  /** Все провайдеры в порядке приоритета со статусом — для переключателя «Источник 1 / 2». */
  providers: ProviderAttempt[];
}

export interface ResolveOptions {
  /** Начать с этого провайдера (пользователь выбрал источник вручную). */
  preferred?: string;
  /** Пропустить провайдеров — например, тех, чей поток только что упал в плеере. */
  exclude?: string[];
}

const isHttp = (u: string) => {
  try {
    const p = new URL(u).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
};

const keyOf = (providerId: string, p: ResolveParams) => `${providerId}|${p.kind}:${p.tmdbId}:${p.season ?? ''}:${p.episode ?? ''}`;

/**
 * Цепочка провайдеров с фоллбеком.
 *
 * Опрашивает провайдеров последовательно в порядке приоритета и останавливается на первом,
 * который вернул хотя бы один поток. Остальные помечаются `untried` — UI показывает их в
 * переключателе, и при выборе запрос уходит с `preferred`. Результаты кэшируются, поэтому
 * повторный выбор источника и возврат к карточке не дёргают бэкенды заново.
 */
export class ProviderManager {
  /** Кэш ответов: найденное живёт 10 минут, «нет такого тайтла» — минуту. */
  private cache = new Map<string, { streams: ProviderStream[]; expires: number }>();

  constructor(
    private readonly providers: StreamProvider[],
    private readonly opts: { timeoutMs?: number; log?: (msg: string, err?: unknown) => void } = {},
  ) {
    const ids = new Set<string>();
    for (const p of providers) {
      if (ids.has(p.id)) throw new Error(`duplicate provider id: ${p.id}`);
      ids.add(p.id);
    }
  }

  list(): { id: string; name: string }[] {
    return this.providers.map((p) => ({ id: p.id, name: p.name }));
  }

  async resolveWithFallback(params: ResolveParams, options: ResolveOptions = {}): Promise<ResolveResult> {
    const exclude = new Set(options.exclude ?? []);
    const attempts = new Map<string, ProviderAttempt>(
      this.providers.map((p) => [p.id, { id: p.id, name: p.name, status: exclude.has(p.id) ? 'error' : 'untried' }]),
    );
    const order = [...this.providers].sort((a, b) => Number(b.id === options.preferred) - Number(a.id === options.preferred));

    for (const provider of order) {
      if (exclude.has(provider.id)) continue;
      const attempt = attempts.get(provider.id)!;
      try {
        const streams = await this.resolveOne(provider, params);
        if (streams.length) {
          attempt.status = 'ok';
          return { providerId: provider.id, streams, providers: [...attempts.values()] };
        }
        attempt.status = 'empty';
      } catch (err) {
        attempt.status = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'error';
        attempt.error = err instanceof Error ? err.message : String(err);
        this.opts.log?.(`provider ${provider.id} failed`, err);
      }
    }
    return { providerId: null, streams: [], providers: [...attempts.values()] };
  }

  /** Один провайдер с таймаутом, кэшем и санитизацией ответа. */
  private async resolveOne(provider: StreamProvider, params: ResolveParams): Promise<ProviderStream[]> {
    const key = keyOf(provider.id, params);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.streams;

    const ctrl = new AbortController();
    const timeoutMs = this.opts.timeoutMs ?? 8000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raw = await Promise.race([
      provider.resolveMedia(params, ctrl.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`${provider.id}: no answer in ${timeoutMs} ms`);
          err.name = 'TimeoutError';
          ctrl.abort(err);
          reject(err);
        }, timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    // Провайдер — внешний код: доверяем только корректным http(s)-ссылкам известных типов.
    const streams = (raw ?? []).filter((s) => isHttp(s.url) && (s.type === 'hls' || s.type === 'mp4'));
    this.cache.set(key, { streams, expires: Date.now() + (streams.length ? 10 * 60_000 : 60_000) });
    if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value!);
    return streams;
  }
}
