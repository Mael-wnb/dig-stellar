// apps/indexer/src/lib/protocols/defindex/types.ts

// One underlying-asset holding of a vault, as returned by the DeFindex API's
// totalManagedFunds. `rawAmount` is in the asset's smallest unit (needs scaling
// by the asset decimals to get human units).
export type DefindexVaultHolding = {
  assetContract: string; // Stellar Asset Contract (SAC) id of the underlying
  rawAmount: string; // integer string, asset smallest unit
};

// Normalized snapshot of a vault, produced by fetch-vault.ts.
export type DefindexVaultFetch = {
  vaultAddress: string;
  name: string | null;
  symbol: string | null;
  // 7-day APY as reported by the DeFindex API, in PERCENT units (e.g. 7.14 = 7.14%).
  apyPct: number | null;
  holdings: DefindexVaultHolding[];
};

// Result of persisting a vault's metrics (returned for logging).
export type DefindexVaultMetrics = {
  completedAt: string;
  entitySlug: string;
  tvlUsd: number;
  supplyApy: number | null; // fraction (0.0714), as stored in pool_metrics_latest
  pricedHoldings: number;
  unpricedHoldings: number;
};
