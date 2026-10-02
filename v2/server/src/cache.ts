/** Small TTL + LRU cache. Map iteration order doubles as recency order. */
export class TtlLru<V> {
  private readonly map = new Map<string, { value: V; at: number }>();
  private readonly max: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(max: number, ttlMs: number, now: () => number = Date.now) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string): { value: V } | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.now() - e.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return { value: e.value };
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, at: this.now() });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
