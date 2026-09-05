// apps/web/src/api/ops.ts
// Lot ST — post-grant upgrade (Sept 2026), builds on Lot E: the status page's
// ONLY data source. Mirrors the
// GET /v1/ops/status contract — the server computes everything (states,
// availability, gaps); the web renders dumbly and never re-derives a rule.

import { apiFetch } from './client'

export type OpsSegmentState = 'ok' | 'degraded' | 'failed'
export type OpsComponentState = OpsSegmentState | 'stale'
export type OpsOverallState = 'operational' | 'degraded' | 'outage' | 'unknown'

export type OpsStepSegment = {
  runAt: string
  state: OpsSegmentState
  durationMs: number
  message: string | null
}

export type OpsRpcSegment = {
  runAt: string
  state: OpsSegmentState
  calls: number
  errors: number
  errorRate: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

export type OpsStatusSegment = OpsStepSegment | OpsRpcSegment

export type OpsStatusComponent = {
  id: string
  kind: 'step' | 'rpc'
  label: string
  state: OpsComponentState
  availability24h: number | null
  segments: OpsStatusSegment[]
}

// `before: null` = open-ended trailing gap (last run → now, refresh overdue).
export type OpsStatusGap = { after: string; before: string | null; missedCycles: number }

export type OpsStatusResponse = {
  window: string
  generatedAt: string
  cadenceMinutes: number
  staleAfterSeconds: number
  historySince: string | null
  // Set when history starts inside the window (fresh deploy): the span before
  // it is "no data" (empty slots), not missed cycles.
  noDataBefore: string | null
  runs: Array<{ runAt: string }>
  gaps: OpsStatusGap[]
  overall: {
    state: OpsOverallState
    lastRunAt: string | null
    missedCycles24h: number
    failedSteps24h: number
  }
  components: OpsStatusComponent[]
}

export async function fetchOpsStatus(): Promise<OpsStatusResponse> {
  return apiFetch<OpsStatusResponse>('/ops/status?window=24h')
}
