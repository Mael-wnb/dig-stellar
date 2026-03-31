// apps/indexer/src/lib/protocols/blend/types.ts

export type BlendReserveAsset = {
    contractId: string;
    name: string | null;
    symbol: string | null;
    decimals: number;
  };
  
  export type BlendReserveRow = {
    assetId: string;
    symbol: string | null;
    name: string | null;
    decimals: number;
    enabled: boolean | null;
    dSupplyRaw: string | null;
    bSupplyRaw: string | null;
    backstopCreditRaw: string | null;
    dSupplyScaled: string | null;
    bSupplyScaled: string | null;
    backstopCreditScaled: string | null;
    supplyCapRaw: string | null;
    supplyCapScaled: string | null;
    borrowApr: number | null;
    estBorrowApy: number | null;
    supplyApr: number | null;
    estSupplyApy: number | null;
  };
  
  export type BlendPoolState = {
    venueSlug: 'blend';
    entityType: 'lending_pool';
    entitySlug: string;
    poolId: string;
    poolName: string | null;
    reserveCount: number;
    metadata: {
      admin: string | null;
      backstop: string | null;
      backstopRate: number | null;
      oracle: string | null;
      status: number | null;
      maxPositions: number | null;
      minCollateral: string | null;
      reserveList: string[];
      latestLedger: number | null;
      wasmHash: string | null;
    };
    assets: BlendReserveAsset[];
    reserveRows: BlendReserveRow[];
  };
  
  export type BlendPoolMetrics = {
    tvlUsd: number;
    totalSuppliedUsd: number;
    totalBorrowedUsd: number;
    totalBackstopCreditUsd: number;
    netLiquidityUsd: number;
    weightedSupplyApy: number | null;
    weightedBorrowApy: number | null;
    reserveBreakdown: Array<{
      assetId: string;
      symbol: string | null;
      name: string | null;
      priceUsd: number | null;
      supplied: number;
      suppliedUsd: number | null;
      borrowed: number;
      borrowedUsd: number | null;
      backstopCredit: number;
      backstopCreditUsd: number | null;
      supplyApr: number | null;
      supplyApy: number | null;
      borrowApr: number | null;
      borrowApy: number | null;
    }>;
  };