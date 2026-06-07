// src/types/protocol.ts

export interface ProtocolSummary {
    id: string
    name: string
    type: string
  }
  
  export interface PoolTokenSummary {
    assetId: string
    symbol: string
    role: string
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
  }