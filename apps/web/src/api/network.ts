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
  // Freshness (T1-D2 / Lot B): computed at read time in the API.
  isStale?: boolean | null
  staleAfterSeconds?: number | null
}

export async function fetchNetworkStats(): Promise<NetworkStatsResponse> {
  return apiFetch<NetworkStatsResponse>('/network/stats')
}

// G4 (Lot G): network TVL 7-day series from network_tvl_snapshots (G0).
// Single TVL source for BOTH the hero (latest point) and the chart (series)
// since the 2026-08-17 ruling — "Total value tracked", DeFindex excluded.
export type NetworkTvlPoint = {
  t: string // hour bucket, ISO
  tvlUsd: number // gross — "Total value tracked"
  tvlNetUsd: number | null // supplied − borrowed; null on pre-2026-08-17 points
  protocolCount: number
}

export type NetworkTvlSeriesResponse = {
  series: NetworkTvlPoint[]
  meta: {
    source: 'snapshots'
    from: string
    to: string
    firstSnapshotAt: string | null
    partial: boolean
    bucket: 'hour'
    // First point under the 2026-08-17 definition when older points exist —
    // marks the definitional step-down for the chart footnote.
    methodologyChangeAt: string | null
  }
}

export async function fetchNetworkTvlSeries(): Promise<NetworkTvlSeriesResponse> {
  return apiFetch<NetworkTvlSeriesResponse>('/network/tvl-series')
}