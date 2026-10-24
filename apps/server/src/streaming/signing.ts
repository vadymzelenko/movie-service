import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Что именно проксируем. Токен зашифрован AES-256-GCM: клиент не может ни подделать адрес
 * (прокси не «открытый»), ни прочитать его — в upstream-URL бывают ключи API (Jellyfin).
 */
export interface ProxyTarget {
  /** Абсолютный upstream-URL. */
  u: string;
  /** Referer/Origin, которые требует CDN источника. */
  r?: string;
  /** Срок жизни (unix-секунды). */
  e: number;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

export class UrlSigner {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly ttlSec: number,
  ) {
    this.key = createHash('sha256').update(`proxy-token:${secret}`).digest();
  }

  sign(target: Omit<ProxyTarget, 'e'>): string {
    const full: ProxyTarget = { ...target, e: Math.floor(Date.now() / 1000) + this.ttlSec };
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(full), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
  }

  verify(token: string): ProxyTarget | null {
    try {
      const raw = Buffer.from(token, 'base64url');
      if (raw.length <= IV_BYTES + TAG_BYTES) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, IV_BYTES));
      decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
      const json = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString('utf8');
      const target = JSON.parse(json) as ProxyTarget;
      if (typeof target.u !== 'string' || typeof target.e !== 'number') return null;
      if (target.e < Date.now() / 1000) return null;
      const proto = new URL(target.u).protocol;
      return proto === 'http:' || proto === 'https:' ? target : null;
    } catch {
      return null;
    }
  }
}
