export interface PoolDisplay {
  id: string
  name: string
  type: string
  chain: string
  contractAddress: string | null   // ✅ FIX
  updatedAt: string | null         // ✅ FIX

  metrics: {
    tvlUsd: number | null

    volume24hUsd: number | null
    fees24hUsd: number | null
    swaps24h: number | null

    totalSuppliedUsd: number | null
    totalBorrowedUsd: number | null
    netLiquidityUsd: number | null
    totalBackstopCreditUsd: number | null

    supplyApy: number | null
    borrowApy: number | null
  }

  reserves?: any[]
  tokens?: any[]
}