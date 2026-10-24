/** Маленький TTL-кэш с LRU-вытеснением и склейкой параллельных запросов. */
export class TtlCache<V> {
  private store = new Map<string, { value: Promise<V>; expires: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 2000,
  ) {}

  wrap(key: string, load: () => Promise<V>): Promise<V> {
    const now = Date.now();
    const hit = this.store.get(key);
    if (hit && hit.expires > now) {
      // Переставляем в конец — Map хранит порядок вставки, это и есть LRU.
      this.store.delete(key);
      this.store.set(key, hit);
      return hit.value;
    }
    const value = load();
    this.store.set(key, { value, expires: now + this.ttlMs });
    value.catch(() => this.store.delete(key));
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
    return value;
  }
}
