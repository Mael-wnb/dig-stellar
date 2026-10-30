// apps/api/src/common/ttl-cache.ts
//
// Minimal in-process TTL cache for read endpoints whose data only changes on
// the */15 refresh sweep (perf/pools-latency, 2026-10-30). Beta-first: a Map on
// the singleton service, no Redis, no interceptor, no eviction beyond expiry
// (keys are a handful of query-param combinations).
//
// Concurrent misses for the same key share ONE in-flight loader promise, so a
// burst of first-paint requests landing while a refresh job is hogging the
// 1 vCPU triggers a single DB round-trip instead of a stampede. A loader
// failure is never cached.
//
// `ttlMs <= 0` disables caching entirely (every get() runs the loader) — the
// ops switch and what the SQL-text specs rely on when they need a miss.

export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async get(key: string, loader: () => Promise<T>): Promise<T> {
    if (this.ttlMs <= 0) return loader();

    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = loader().then(
      (value) => {
        this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
        this.inFlight.delete(key);
        return value;
      },
      (err: unknown) => {
        this.inFlight.delete(key);
        throw err;
      },
    );
    this.inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.entries.clear();
  }
}

// Parse a TTL from the environment: unset/blank → default; a non-negative
// finite number → that many ms (0 disables); anything else → default.
export function ttlMsFromEnv(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultMs;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : defaultMs;
}
