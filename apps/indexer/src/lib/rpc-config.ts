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
