// apps/web/src/api/network.ts
import { apiFetch } from './client'

export type NetworkStatsResponse = {
  xlmPriceUsd: number | null
  xlmPriceChange24hPct: number | null
  stellarTvlUsd: number | null
  activeWallets: number | null
  stableMcapUsd: number | null
  dexVolume24hUsd: number | null
  protocolCount: number
  usdcSupplyUsd: number | null
  avgTxFeeXlm: number | null
  updatedAt: string
}

export async function fetchNetworkStats(): Promise<NetworkStatsResponse> {
  return apiFetch<NetworkStatsResponse>('/network/stats')
}