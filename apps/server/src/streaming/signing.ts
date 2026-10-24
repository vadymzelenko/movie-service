import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Что именно проксируем. Подписывается HMAC-ом, поэтому прокси не является
 * «открытым»: он ходит только по адресам, которые сервер сам выдал клиенту.
 */
export interface ProxyTarget {
  /** Абсолютный upstream-URL. */
  u: string;
  /** Referer/Origin, которые требует CDN источника. */
  r?: string;
  /** Срок жизни (unix-секунды). */
  e: number;
}

export class UrlSigner {
  constructor(
    private readonly secret: string,
    private readonly ttlSec: number,
  ) {}

  private mac(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url').slice(0, 32);
  }

  sign(target: Omit<ProxyTarget, 'e'>): string {
    const full: ProxyTarget = { ...target, e: Math.floor(Date.now() / 1000) + this.ttlSec };
    const payload = Buffer.from(JSON.stringify(full)).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  verify(token: string): ProxyTarget | null {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const payload = token.slice(0, dot);
    const sig = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(this.mac(payload));
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
    try {
      const target = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ProxyTarget;
      if (typeof target.u !== 'string' || typeof target.e !== 'number') return null;
      if (target.e < Date.now() / 1000) return null;
      const proto = new URL(target.u).protocol;
      return proto === 'http:' || proto === 'https:' ? target : null;
    } catch {
      return null;
    }
  }
}
