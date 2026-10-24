const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export interface UpstreamOptions {
  referer?: string;
  accept?: string;
  range?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`upstream ${status} for ${new URL(url).host}`);
  }
}

/** Запрос к источнику с «браузерными» заголовками, которые обычно требуют CDN. */
export async function fetchUpstream(url: string, opts: UpstreamOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { 'user-agent': UA, accept: opts.accept ?? '*/*' };
  if (opts.referer) {
    headers.referer = opts.referer;
    headers.origin = new URL(opts.referer).origin;
  }
  if (opts.range) headers.range = opts.range;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  const res = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
  });
  if (!res.ok && res.status !== 206) throw new UpstreamError(res.status, url);
  return res;
}
