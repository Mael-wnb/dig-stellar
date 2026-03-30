// apps/indexer/src/lib/protocols/blend/types.ts
export type BlendReserveMetricRow = {
    assetId: string;
    symbol: string | null;
    name: string | null;
    priceUsd: number | null;
    supplied: number;
    borrowed: number;
    backstopCredit: number;
    supplyApy: number | null;
    borrowApy: number | null;
    suppliedUsd: number;
    borrowedUsd: number;
    backstopCreditUsd: number;
  };
  
  export type BlendPoolMetrics = {
    entitySlug: string;
    tvlUsd: number;
    totalSuppliedUsd: number;
    totalBorrowedUsd: number;
    totalBackstopCreditUsd: number;
    netLiquidityUsd: number;
    weightedSupplyApy: number | null;
    weightedBorrowApy: number | null;
    reserveBreakdown: BlendReserveMetricRow[];
  };