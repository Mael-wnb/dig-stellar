export interface PoolDisplay {
  id: string
  name: string

  type: string
  chain: string
  contractAddress: string | null
  updatedAt?: string | null
  // Freshness (T3-D1): computed at read time in the API.
  isStale?: boolean | null
  staleAfterSeconds?: number | null

  metrics: {
    tvlUsd?: number | null

    volume24hUsd?: number | null
    fees24hUsd?: number | null
    swaps24h?: number | null
    events24h?: number | null
    trades24h?: number | null

    totalSuppliedUsd?: number | null
    totalBorrowedUsd?: number | null
    netLiquidityUsd?: number | null
    totalBackstopCreditUsd?: number | null

    supplyApy?: number | null
    borrowApy?: number | null
  }

  reserves?: any[]
  tokens?: any[]
}