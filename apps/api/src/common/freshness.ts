// apps/api/src/common/freshness.ts
//
// First-class freshness for the read path (T3-D1). Staleness is computed at read
// time in the API from each row's `as_of` — no new indexer state. A payload is
// "stale" when it is older than FRESHNESS_STALE_AFTER_MINUTES (default 45 = 3×
// the 15-min cron: one missed cycle is tolerated, two is stale).
//
// The threshold is read per-call so the forced-stale drill can flip
// FRESHNESS_STALE_AFTER_MINUTES=1 on the API (a PM2 restart re-reads env) without
// a code change. Legacy STALE_THRESHOLD_MINUTES is honoured as a fallback.

export function staleAfterMinutes(): number {
  const raw =
    process.env.FRESHNESS_STALE_AFTER_MINUTES ??
    process.env.STALE_THRESHOLD_MINUTES ??
    '45';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 45;
}

export function staleAfterSeconds(): number {
  return Math.round(staleAfterMinutes() * 60);
}

export type Freshness = {
  // true  -> data older than the threshold
  // false -> data within the threshold
  // null  -> as_of unknown / unparseable (no metrics row yet)
  isStale: boolean | null;
  // The configured threshold, so the UI can label it ("older than 45m").
  staleAfterSeconds: number;
  // Age of the data in seconds, or null when as_of is unknown.
  ageSeconds: number | null;
};

export function computeFreshness(asOf: unknown): Freshness {
  const staleAfter = staleAfterSeconds();

  if (asOf === null || asOf === undefined) {
    return { isStale: null, staleAfterSeconds: staleAfter, ageSeconds: null };
  }

  const ts = new Date(asOf as string | number | Date).getTime();
  if (!Number.isFinite(ts)) {
    return { isStale: null, staleAfterSeconds: staleAfter, ageSeconds: null };
  }

  const ageSeconds = Math.max(0, Math.round((Date.now() - ts) / 1000));

  return {
    isStale: ageSeconds > staleAfter,
    staleAfterSeconds: staleAfter,
    ageSeconds,
  };
}
