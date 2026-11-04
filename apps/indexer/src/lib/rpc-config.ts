// apps/indexer/src/lib/rpc-config.ts
import 'dotenv/config';

/**
 * Canonical Soroban RPC endpoint resolution — single source of truth.
 *
 * Priority:
 *   1. explicit override (caller-provided rpcUrl)
 *   2. STELLAR_RPC_URL   (.env — the operator endpoint; may embed an API key in the path)
 *   3. SOROBAN_RPC_URL   (.env — secondary)
 *   4. public SDF endpoint (LAST RESORT; rate-limited, no key)
 *
 * IMPORTANT: STELLAR_RPC_URL wins over SOROBAN_RPC_URL. Do not reintroduce
 * per-file fallbacks that prefer the public endpoint — call resolveRpcUrl() instead.
 */
const PUBLIC_FALLBACK_RPC_URL = 'https://mainnet.sorobanrpc.com';

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function resolveRpcUrl(override?: string): string {
  return (
    firstNonEmpty(
      override,
      process.env.STELLAR_RPC_URL,
      process.env.SOROBAN_RPC_URL,
    ) ?? PUBLIC_FALLBACK_RPC_URL
  );
}

/**
 * Mask an RPC URL for logging. Returns the host only — never the path/query,
 * which may carry an API key (e.g. validationcloud `/v1/<key>`).
 */
export function maskRpcUrl(url: string | undefined | null): string {
  if (!url) return '(unset)';
  try {
    return new URL(url).host;
  } catch {
    return '***';
  }
}

// ── Horizon-shaped URLs (Lot PRE, PRE2) ──────────────────────────────────────
// Horizon REST is recognised by its PATH, not its host: the operator provider
// (Validation Cloud) serves Horizon under `/v1/<key>/...` on the same host as
// Soroban RPC, so a host-based rule would file trades pages under the RPC row.
export const HORIZON_RESOURCE_SEGMENTS: ReadonlySet<string> = new Set([
  'liquidity_pools',
  'accounts',
  'fee_stats',
  'trades',
  'order_book',
  'paths',
  'ledgers',
  'transactions',
  'operations',
  'effects',
  'offers',
]);

/** Index of the first Horizon resource in `pathname.split('/')` segments, or -1. */
export function horizonResourceIndex(segments: string[]): number {
  return segments.findIndex((segment) => HORIZON_RESOURCE_SEGMENTS.has(segment));
}

/**
 * The Horizon part of a URL's path (`/liquidity_pools/<id>/trades`), dropping
 * anything before the resource (the provider key segment) and the query string.
 * null when the path carries no Horizon resource.
 */
export function horizonPathOf(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const index = horizonResourceIndex(segments);
    return index < 0 ? null : `/${segments.slice(index).join('/')}`;
  } catch {
    return null;
  }
}

/**
 * The Horizon path with every identifier replaced by `{id}`
 * (`/liquidity_pools/{id}/trades`, `/accounts/{id}`, `/fee_stats`), dropping
 * anything before the resource (the provider key segment) and the query string.
 * Horizon paths alternate resource / id / sub-resource, so the segments at odd
 * offsets from the resource are ids. null when the path carries no Horizon
 * resource. Used by the ops capture as the method label (Lot PRE, PRE3): it
 * never carries an account address, a pool id or a key.
 */
export function horizonPathTemplateOf(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const index = horizonResourceIndex(segments);
    if (index < 0) return null;
    const shaped = segments.slice(index).map((segment, offset) => (offset % 2 === 1 ? '{id}' : segment));
    return `/${shaped.join('/')}`;
  } catch {
    return null;
  }
}

/**
 * Mask a Horizon-shaped URL for logging: host + Horizon path, never the query
 * (paging cursors) nor the key segment. Falls back to the host only.
 */
export function maskHorizonUrl(url: string | undefined | null): string {
  if (!url) return '(unset)';
  try {
    const host = new URL(url).host;
    const path = horizonPathOf(url);
    return path ? `${host}${path}` : host;
  } catch {
    return '***';
  }
}
