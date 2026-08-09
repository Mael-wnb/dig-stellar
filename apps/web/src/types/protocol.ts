// src/types/protocol.ts

export interface ProtocolSummary {
    id: string
    name: string
    type: string
  }
  
  export interface PoolTokenSummary {
    assetId: string | null
    symbol: string | null
    role?: string

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
    // false → the pool has no deposit/withdraw event coverage; hide the section.
    covered: boolean
    window: '24h' | '7d' | '30d'
    days: number
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