import type { FreshnessMeta } from './types';

/**
 * `true` when the payload is older than its `staleAfterSeconds`, `false` when within it,
 * `null` when the API has no row yet (or the payload carries no freshness fields).
 * Reads `isStale`, falling back to the deprecated `stale` alias.
 */
export function isStale(payload: FreshnessMeta): boolean | null {
  if (payload.isStale !== undefined) return payload.isStale;
  if (payload.stale !== undefined) return payload.stale;
  return null;
}

/** The payload's own data timestamp (`updatedAt`) as a `Date`, or `null` before the first write. */
export function asOfDate(payload: FreshnessMeta): Date | null {
  if (!payload.updatedAt) return null;
  const date = new Date(payload.updatedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}
