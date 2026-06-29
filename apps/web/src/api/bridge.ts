// apps/web/src/api/bridge.ts
import { apiFetch } from './client'

export type BridgeWindow = '24h' | '7d' | '30d'

export type BridgeChainBreakdown = {
  chainId: number | null
  chain: string | null
  amountUsd: number
  count: number
}

export type BridgeDirectionSummary = {
  totalUsd: number
  count: number
  byChain: BridgeChainBreakdown[]
}

export type BridgeSummaryResponse = {
  window: BridgeWindow
  token: string
  inflow: BridgeDirectionSummary
  outflow: BridgeDirectionSummary
  netUsd: number
  lastFlowAt: string | null
  updatedAt: string
}

export type BridgeFlow = {
  direction: 'inflow' | 'outflow'
  chainId: number | null
  chain: string | null
  token: string
  amountScaled: number | null
  amountUsd: number | null
  txHash: string
  recipient: string | null
  occurredAt: string
}

export type BridgeFlowsResponse = {
  count: number
  limit: number
  flows: BridgeFlow[]
}

export type BridgeSeriesPoint = {
  day: string // 'YYYY-MM-DD' (UTC)
  inflowUsd: number
  outflowUsd: number
  netUsd: number
}

export type BridgeSeriesResponse = {
  days: number
  series: BridgeSeriesPoint[]
  updatedAt: string
}

export async function fetchBridgeSummary(
  window: BridgeWindow = '7d'
): Promise<BridgeSummaryResponse> {
  return apiFetch<BridgeSummaryResponse>(`/bridge/summary?window=${window}`)
}

export async function fetchBridgeFlows(
  options: { direction?: 'inflow' | 'outflow'; limit?: number } = {}
): Promise<BridgeFlowsResponse> {
  const params = new URLSearchParams()
  if (options.direction) params.set('direction', options.direction)
  if (options.limit) params.set('limit', String(options.limit))
  const qs = params.toString()
  return apiFetch<BridgeFlowsResponse>(`/bridge/flows${qs ? `?${qs}` : ''}`)
}

export async function fetchBridgeSeries(
  options: { days?: number } = {}
): Promise<BridgeSeriesResponse> {
  const days = options.days ?? 7
  return apiFetch<BridgeSeriesResponse>(`/bridge/series?days=${days}`)
}
