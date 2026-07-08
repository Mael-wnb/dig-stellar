// apps/web/src/composables/useBridgeChart.ts
//
// Data layer for the "Inflows & outflows" bridge chart (SCF T2-D3).
// Faithful to Paul's flowChart, wired to the REAL bridge API through the shared
// house client (api/bridge.ts — same one BridgeFlows.vue uses):
//   fetchBridgeSummary(window)  -> GET /v1/bridge/summary?window=24h|7d|30d  (windowed totals)
//   fetchBridgeFlows({ limit }) -> GET /v1/bridge/flows?limit=…              (recent feed, bucketed here)
//
// Contract reconciled against apps/api/src/modules/bridge/bridge.service.ts:
//   * summary totals live under inflow.totalUsd / outflow.totalUsd / netUsd (nested,
//     not flat inflowUsd) and count = inflow.count + outflow.count;
//   * a flow is { direction:'inflow'|'outflow', amountUsd:number|null, occurredAt:ISO };
//   * the /flows feed is window-INDEPENDENT (latest N, server hard-cap 200) — we pull the
//     max and bucket client-side, filtering to the active window. For the sparse USDC
//     mono-token bridge (Soroban getEvents ~7-day retention) this comfortably covers
//     24h/7d; a busy 30d could exceed 200 rows, in which case the BARS under-count older
//     buckets — the stat tiles stay authoritative (they come from the windowed /summary).
//   (A pre-bucketed /bridge/series endpoint exists for a later, exact-per-window upgrade.)

import { computed, ref } from 'vue'
import {
  fetchBridgeSummary,
  fetchBridgeFlows,
  type BridgeWindow,
} from '../api/bridge'

// Re-exported so BridgeFlowChart.vue keeps importing the window type from here.
export type { BridgeWindow }

const WINDOW_MS: Record<BridgeWindow, number> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
}
const BUCKETS = 24 // chart column count (matches Paul's density)
const FLOWS_LIMIT = 200 // server hard-cap (MAX_FLOW_LIMIT) — pull the whole feed

export interface BridgeBucket {
  inflow: number   // USD
  outflow: number  // USD
  net: number      // cumulative USD (running inflow - outflow)
  centerTs: number // bucket center, for the hover time label
}

export interface BridgeTotals {
  inflowUsd: number
  outflowUsd: number
  netUsd: number
  flowCount: number
}

// amountUsd is number | null off the DTO; coerce null/NaN to 0 for the maths.
const num = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0

export function useBridgeChart() {
  const window = ref<BridgeWindow>('24h')
  const loading = ref(false)
  const error = ref<string | null>(null)

  const summaryTotals = ref<BridgeTotals | null>(null)
  const flows = ref<Array<{ dir: 'in' | 'out'; usd: number; ts: number }>>([])

  async function load() {
    loading.value = true
    error.value = null
    try {
      // summary is window-scoped (authoritative totals); the flows feed is a
      // window-independent latest-N slice we bucket ourselves. Each call is
      // tolerated independently so one failing endpoint still renders the other.
      const [summary, flowsRes] = await Promise.all([
        fetchBridgeSummary(window.value).catch(() => null),
        fetchBridgeFlows({ limit: FLOWS_LIMIT }).catch(() => null),
      ])

      summaryTotals.value = summary
        ? {
            inflowUsd: summary.inflow.totalUsd,
            outflowUsd: summary.outflow.totalUsd,
            netUsd: summary.netUsd,
            flowCount: summary.inflow.count + summary.outflow.count,
          }
        : null

      const rawFlows = flowsRes?.flows ?? []
      flows.value = rawFlows.map((f) => ({
        dir: f.direction === 'outflow' ? 'out' : 'in',
        usd: num(f.amountUsd),
        ts: new Date(f.occurredAt).getTime(),
      }))

      if (!summary && !rawFlows.length) {
        throw new Error('Bridge data unavailable')
      }
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to load bridge flows'
    } finally {
      loading.value = false
    }
  }

  function setWindow(w: BridgeWindow) {
    if (w === window.value) return
    window.value = w
    load()
  }

  // Bucket flows across the selected window into BUCKETS columns.
  const buckets = computed<BridgeBucket[]>(() => {
    const span = WINDOW_MS[window.value]
    const end = Date.now()
    const start = end - span
    const bucketMs = span / BUCKETS

    const inflow = new Array(BUCKETS).fill(0)
    const outflow = new Array(BUCKETS).fill(0)
    for (const f of flows.value) {
      if (f.ts < start || f.ts > end) continue
      const idx = Math.min(BUCKETS - 1, Math.max(0, Math.floor((f.ts - start) / bucketMs)))
      if (f.dir === 'out') outflow[idx] += f.usd
      else inflow[idx] += f.usd
    }
    let run = 0
    return inflow.map((inUsd, i) => {
      run += inUsd - outflow[i]
      return { inflow: inUsd, outflow: outflow[i], net: run, centerTs: start + (i + 0.5) * bucketMs }
    })
  })

  const totals = computed<BridgeTotals>(() => {
    if (summaryTotals.value) return summaryTotals.value
    // fallback: derive from buckets
    const inflowUsd = buckets.value.reduce((s, b) => s + b.inflow, 0)
    const outflowUsd = buckets.value.reduce((s, b) => s + b.outflow, 0)
    return { inflowUsd, outflowUsd, netUsd: inflowUsd - outflowUsd, flowCount: flows.value.length }
  })

  return { window, setWindow, loading, error, load, buckets, totals }
}

// ── shared formatter ────────────────────────────────────────────────────────
export function fmtUsd(v: number, signed = false): string {
  const a = Math.abs(v)
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a.toFixed(0)}`
  if (!signed) return s
  return (v < 0 ? '−' : '+') + s
}