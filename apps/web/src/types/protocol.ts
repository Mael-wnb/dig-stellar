// src/types/protocol.ts

export interface ProtocolSummary {
    id: string
    name: string
    type: string
    // F3 (Lot F): backend-served venue logo. Null/absent → UI monogram fallback.
    logoUrl?: string | null
  }

  export interface PoolTokenSummary {
    assetId: string | null
    symbol: string | null
    role?: string
    // F3 (Lot F): backend-served asset logo. Null/absent → UI monogram fallback.
    logoUrl?: string | null

    // Populated for AMM pool detail (reserve breakdown). Absent in pool lists.
    name?: string | null
    decimals?: number | null
    priceUsd?: number | null
    reserve?: number | null
    reserveUsd?: number | null
  }
  
  export interface PoolMetricsSummary {
    tvlUsd?: number | null
    volume24hUsd?: number | null
    fees24hUsd?: number | null
    totalSuppliedUsd?: number | null
    totalBorrowedUsd?: number | null
    totalBackstopCreditUsd?: number | null
    netLiquidityUsd?: number | null
    supplyApy?: number | null
    borrowApy?: number | null
    swaps24h?: number | null
    events24h?: number | null
    trades24h?: number | null
  }
  
  // Q4 (Lot Q): /v1/protocols item — per-venue aggregates plus the top
  // underlying assets by TVL (up to 3 served) and the honest total count so
  // the UI can render a "+N" overflow chip instead of truncating silently.
  export interface ProtocolAssetMark {
    symbol: string | null
    logoUrl: string | null
    tvlUsd: number | null
  }

  export interface ProtocolListItem {
    id: string
    name: string
    type: string
    chain: string
    logoUrl?: string | null
    tvlUsd?: number | null
    topAssets: ProtocolAssetMark[]
    assetCount: number
  }

  export interface PoolListItem {
    id: string
    name: string
    type: string
    chain: string
    contractAddress: string | null
    protocol: ProtocolSummary
    tokens: PoolTokenSummary[]
    metrics: PoolMetricsSummary
    updatedAt?: string | null
    // Freshness (T3-D1): computed at read time in the API.
    isStale?: boolean | null
    staleAfterSeconds?: number | null
  }
  
  export interface PoolReserveDetail {
    assetId: string
    symbol: string
    name: string
    decimals: number
    // F3 (Lot F): backend-served asset logo. Null/absent → UI monogram fallback.
    logoUrl?: string | null
    priceUsd?: number | null
  
    reserve?: number | null
    reserveUsd?: number | null
  
    supplied?: number | null
    borrowed?: number | null
    backstopCredit?: number | null
    supplyCap?: number | null
  
    supplyApr?: number | null
    supplyApy?: number | null
    borrowApr?: number | null
    borrowApy?: number | null
  }
  
  export interface PoolDetailData {
    id: string
    name: string
    type: string
    chain: string
    contractAddress: string | null
    protocol: ProtocolSummary
    metrics: PoolMetricsSummary
    reserves?: PoolReserveDetail[]
    tokens?: PoolTokenSummary[]
    updatedAt?: string | null
    // Freshness (T3-D1): computed at read time in the API.
    isStale?: boolean | null
    staleAfterSeconds?: number | null
    ageSeconds?: number | null
  }

  // Inflows & outflows (Lot C) — GET /v1/pools/:slug/flows
  export interface PoolFlowsSeriesPoint {
    day: string
    inflowUsd: number
    outflowUsd: number
    netUsd: number
    cumulativeNetUsd: number
  }

  export interface PoolFlows {
    slug: string
    // false → the pool has no MEASURABLE deposit/withdraw event coverage
    // (H4: flow events with computable USD); hide the section.
    covered: boolean
    window: '24h' | '7d' | '30d'
    days: number
    // First day (YYYY-MM-DD) with a measurable flow event — the honest start
    // of the series (event backfill is bounded by Soroban RPC retention).
    coverageSince: string | null
    series: PoolFlowsSeriesPoint[]
    totals: {
      inflowUsd: number
      outflowUsd: number
      netUsd: number
      depositCount: number
      withdrawCount: number
    }
    updatedAt: string
  }

  // TVL history (Lot C) — GET /v1/pools/:slug/series. Blend-only honest
  // reconstruction; covered=false → the UI keeps the "building history" note.
  export interface PoolSeriesPoint {
    day: string
    tvlUsd: number
  }

  export interface PoolSeries {
    slug: string
    covered: boolean
    kind: 'tvl'
    points: PoolSeriesPoint[]
    first: string | null
    last: string | null
    updatedAt: string
  }