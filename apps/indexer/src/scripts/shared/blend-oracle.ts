// apps/indexer/src/scripts/shared/blend-oracle.ts
//
// Blend pool oracles as a price source (price-sources v2, phase B — founder
// arbitration 2026-10-14 §2). Verified on-chain (05-phase-b-design.md §2bis):
// every Blend pool points at its OWN oracle adapter contract (`pool.metadata.oracle`,
// 4 different contracts for our 4 pools), each exposing the SEP-40 surface
// (`lastprice(Asset) -> Option<PriceData>`, `decimals()`, `base()`, `assets()`;
// no `resolution()` / `last_timestamp()`), with 7 or 14 decimals.
//   - Market assets (native, EURC, AQUA, USTRY, CETES, TESOURO) carry 300 s-aligned
//     timestamps: Reflector-style feeds behind the adapter.
//   - Pegged assets (USDC, PYUSD, USDGLO, oUSD) are hard-coded at 1 and stamped
//     with the CURRENT ledger time → reported `pegged`: a peg assumption, not an
//     independent market source.
// This source is therefore the "Blend parity" check (what Blend itself values the
// reserve at — the figure its health factors use), never a primary.
import { Networks } from '@stellar/stellar-sdk';
import { PoolV2 } from '@blend-capital/blend-sdk';
import type { SorobanReader } from './soroban-read';
import { readOraclePrice, type OracleRead } from './reflector';

export type BlendPoolOracle = {
  poolSlug: string;
  poolId: string;
  oracleId: string;
  /** reserve asset contract ids the pool holds (the assets the oracle must price) */
  assets: string[];
};

/**
 * Discover each Blend pool's oracle contract and reserve assets through the SDK
 * (ledger-entry reads, no simulation). A pool that fails to load is skipped and
 * reported; the others still count. Never throws.
 */
export async function discoverBlendOracles(
  rpcUrl: string,
  pools: Array<{ slug: string; contractId: string }>
): Promise<{ oracles: BlendPoolOracle[]; failures: Array<{ poolSlug: string; error: string }> }> {
  const network = { passphrase: Networks.PUBLIC, rpc: rpcUrl };
  const oracles: BlendPoolOracle[] = [];
  const failures: Array<{ poolSlug: string; error: string }> = [];
  for (const pool of pools) {
    try {
      const loaded = await PoolV2.load(network, pool.contractId);
      oracles.push({
        poolSlug: pool.slug,
        poolId: pool.contractId,
        oracleId: loaded.metadata.oracle,
        assets: [...loaded.reserves.keys()],
      });
    } catch (error) {
      failures.push({ poolSlug: pool.slug, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { oracles, failures };
}

export type BlendOracleRead = OracleRead & { poolSlug: string; oracleId: string };

/** Price of one reserve asset from one pool's oracle; `pegged` when it is a hard-coded peg. */
export async function readBlendOraclePrice(
  reader: SorobanReader,
  oracle: BlendPoolOracle,
  assetContractId: string,
  now: Date
): Promise<BlendOracleRead> {
  const res = await readOraclePrice(reader, oracle.oracleId, { kind: 'stellar', contractId: assetContractId }, { now });
  return { ...res, poolSlug: oracle.poolSlug, oracleId: oracle.oracleId };
}

export const blendOracleSourceLabel = (poolSlug: string, symbol: string): string =>
  `blend_oracle_${poolSlug.replace(/^blend-/, '').replace(/-pool$/, '')}_${symbol === 'native' ? 'xlm' : symbol.toLowerCase()}`;
