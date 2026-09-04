// apps/web/src/composables/useBridge.ts
//
// Bridge data for the full Paul-DA section (SCF T2-D3). Feeds the dumb
// BridgeSection: window + chain scope in, and scoped/sorted view models out
// (stat totals, chart buckets, per-chain routes, recent-flows feed). All derived
// from the real /v1/bridge/* endpoints via the house api/bridge client:
//   fetchBridgeSummary(window)  -> windowed totals + per-chain byChain
//   fetchBridgeFlows({ limit })  -> recent feed (window-independent, cap 200)
//   fetchBridgeSeries({ days })  -> daily gap-filled inflow/outflow series
//
// Chart buckets: for the unscoped 7d/30d view we use the authoritative, gap-filled
// /series (daily). For 24h — too coarse for daily — and for any chain-scoped view
// (which /series can't filter), we client-bucket the recent feed over the window.
// The feed is latest-N (cap 200); on a busy 30d that under-counts the oldest
// buckets, but the stat strip stays authoritative (it comes from /summary). Sparse
// windows are expected for the USDC mono-token bridge (~7-day event retention).

import { ref, computed, onMounted } from 'vue'
import {
  fetchBridgeSummary,
  fetchBridgeFlows,
  fetchBridgeSeries,
  type BridgeSummaryResponse,
  type BridgeSeriesPoint,
  type BridgeFlow,
  type BridgeWindow,
} from '../api/bridge'

// Pull the whole feed (server hard-cap) so client bucketing + the scoped feed have
// as much to work with as the API allows.
const RECENT_FLOWS_LIMIT = 200
const CHART_BUCKETS = 24 // client-bucket column count (24h / scoped views)

const WINDOW_MS: Record<BridgeWindow, number> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
}
const seriesDaysFor = (w: BridgeWindow): number => (w === '30d' ? 30 : 7)

// ── Upstream-paused rule (single source of truth) ───────────────────────────
// One definition for "the underlying bridge (Allbridge) looks paused": no flow
// for more than BRIDGE_UPSTREAM_STALE_DAYS. Used by the BridgeSection staleness
// banner AND the status page's Allbridge row suffix (Lot ST) — never duplicate
// the threshold or the day arithmetic elsewhere.
export const BRIDGE_UPSTREAM_STALE_DAYS = 3

export function daysSinceLastFlowOf(flows: Array<{ occurredAt: string }>): number | null {
  let latest = 0
  for (const f of flows) {
    const ts = new Date(f.occurredAt).getTime()
    if (Number.isFinite(ts) && ts > latest) latest = ts
  }
  if (!latest) return null
  return Math.floor((Date.now() - latest) / 86_400_000)
}

export function isBridgeUpstreamPaused(daysSinceLastFlow: number | null): boolean {
  return daysSinceLastFlow != null && daysSinceLastFlow > BRIDGE_UPSTREAM_STALE_DAYS
}

// Lot ST: lightweight module-scoped probe of the SAME condition for views that
// only need the boolean (status page row suffix) — one flows fetch (limit 1,
// the freshest flow decides), shared across consumers, lazy on first use.
const upstreamPausedRef = ref<boolean | null>(null)
let upstreamPausedLoaded = false

export function useBridgeUpstreamPaused() {
  if (!upstreamPausedLoaded) {
    upstreamPausedLoaded = true
    fetchBridgeFlows({ limit: 1 })
      .then((res) => {
        upstreamPausedRef.value = isBridgeUpstreamPaused(daysSinceLastFlowOf(res.flows))
      })
      .catch(() => {
        // Unknown stays null — the suffix simply doesn't render.
        upstreamPausedRef.value = null
      })
  }
  return { upstreamPaused: upstreamPausedRef }
}

// ── chain identity ───────────────────────────────────────────────────────────
// Real Allbridge source chains (not Paul's mock ETH/BNB/ARB). tint/color are
// per-chain accents with a neutral fallback; `logo` is a bundled brand mark
// rendered through BrandLogo, with the 1-letter monogram (`mark`) as the safe
// fallback for any chain we don't ship an SVG for (never a broken image).
//
// G1 (Lot G / T3-D3): bundled marks for the chains actually present in
// /v1/bridge/* — the top 7 by flow volume observed in bridge_flows
// (BAS, POL, ETH, SOL, ARB, BSC, CEL). Anything else falls back to the
// monogram, never a broken image. Simplified brand glyphs authored in-house —
// swap for official brand-kit SVGs later. Sources:
//   Solana   https://solana.com/branding
//   Polygon  https://polygon.technology/brand-kit
//   Base     https://github.com/base-org/brand-kit
//   Celo     https://celo.org/brand
//   Ethereum https://ethereum.org/en/assets
//   BNB      https://www.bnbchain.org/en/brand-guidelines
//   Arbitrum https://arbitrum.foundation/brandkit
import solanaLogo from '@/assets/chains/solana.svg'
import polygonLogo from '@/assets/chains/polygon.svg'
import baseLogo from '@/assets/chains/base.svg'
import celoLogo from '@/assets/chains/celo.svg'
import ethereumLogo from '@/assets/chains/ethereum.svg'
import bnbLogo from '@/assets/chains/bnb.svg'
import arbitrumLogo from '@/assets/chains/arbitrum.svg'

const CHAIN_LOGO: Record<string, string> = {
  SOL: solanaLogo,
  POL: polygonLogo,
  BAS: baseLogo,
  CEL: celoLogo,
  ETH: ethereumLogo,
  BSC: bnbLogo,
  ARB: arbitrumLogo,
}
const CHAIN_TINT: Record<string, { tint: string; color: string }> = {
  ETH: { tint: '#1E2340', color: '#8AA0E6' },
  BSC: { tint: '#332B10', color: '#E6B93B' },
  TRX: { tint: '#3A1616', color: '#E05555' },
  SOL: { tint: '#241633', color: '#B072F5' },
  POL: { tint: '#231640', color: '#A579F0' },
  ARB: { tint: '#16283A', color: '#4FA8E0' },
  AVA: { tint: '#3A1616', color: '#E06A6A' },
  BAS: { tint: '#16233A', color: '#5B8DEF' },
  OPT: { tint: '#3A1618', color: '#E0554E' },
  CEL: { tint: '#0F3021', color: '#35D07F' },
  SNC: { tint: '#22262E', color: '#9DB0C7' },
  SUI: { tint: '#16283A', color: '#4FB8E0' },
  UNI: { tint: '#331630', color: '#E06AC0' },
  ALG: { tint: '#222222', color: '#C8C9C4' },
  STX: { tint: '#241A33', color: '#8E7BE0' },
  LIN: { tint: '#222831', color: '#9DB0C7' },
}
function chainStyle(chain: string): {
  mark: string
  tint: string
  color: string
  logo: string | null
} {
  const s = CHAIN_TINT[chain] ?? { tint: '#242422', color: '#9a9b99' }
  return {
    mark: (chain?.[0] ?? '?').toUpperCase(),
    logo: CHAIN_LOGO[chain] ?? null,
    ...s,
  }
}

const num = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0

// Bucket center for a 'YYYY-MM-DD' UTC day = noon UTC that day.
const dayCenterTs = (day: string): number => new Date(`${day}T12:00:00Z`).getTime()

// ── view-model shapes (match the dumb components) ────────────────────────────
export interface BridgeBucket {
  inflow: number
  outflow: number
  net: number
  centerTs: number
}
export interface BridgeRouteRow {
  chain: string
  mark: string
  tint: string
  color: string
  logo: string | null
  inflowUsd: number
  outflowUsd: number
  netUsd: number
  share: number // 0–100 (of total inflow)
}
export interface BridgeFlowRow {
  id: string
  chain: string
  mark: string
  tint: string
  color: string
  logo: string | null
  dir: 'in' | 'out'
  asset: string
  amountUsd: number
  occurredAt: string
  txHash: string
}
type SortState = { key: string; dir: 'asc' | 'desc' }

function toggleSort(cur: SortState, key: string): SortState {
  if (key === cur.key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: 'desc' }
}
function sortBy<T>(
  rows: T[],
  sort: SortState,
  keymap: Record<string, (r: T) => string | number>
): T[] {
  const get = keymap[sort.key]
  if (!get) return rows
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = get(a)
    const vb = get(b)
    if (typeof va === 'string' && typeof vb === 'string') {
      return va.localeCompare(vb) * dir
    }
    return (Number(va) - Number(vb)) * dir
  })
}

export function useBridge() {
  const summary = ref<BridgeSummaryResponse | null>(null)
  const rawFlows = ref<BridgeFlow[]>([])
  const series = ref<BridgeSeriesPoint[]>([])

  const window = ref<BridgeWindow>('30d') // default 30d: fullest net-flow context, and the
  // window over which a multi-day pause (e.g. Allbridge) is legible as a pause, not a gap
  const chainScope = ref<string | null>(null) // null = all chains

  const loading = ref(true)
  const error = ref<string | null>(null)

  const routeSort = ref<SortState>({ key: 'inflow', dir: 'desc' })
  const flowSort = ref<SortState>({ key: 'time', dir: 'desc' })

  async function load() {
    loading.value = true
    error.value = null
    try {
      const [summaryData, flowsData, seriesData] = await Promise.all([
        fetchBridgeSummary(window.value),
        fetchBridgeFlows({ limit: RECENT_FLOWS_LIMIT }),
        fetchBridgeSeries({ days: seriesDaysFor(window.value) }),
      ])
      summary.value = summaryData
      rawFlows.value = flowsData.flows
      series.value = seriesData.series
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : 'Failed to load bridge flows'
    } finally {
      loading.value = false
    }
  }

  async function setWindow(next: BridgeWindow) {
    if (next === window.value) return
    window.value = next
    // Only the window-scoped summary + series depend on the window; the recent
    // feed is window-independent, so leave it.
    loading.value = true
    error.value = null
    try {
      const [summaryData, seriesData] = await Promise.all([
        fetchBridgeSummary(next),
        fetchBridgeSeries({ days: seriesDaysFor(next) }),
      ])
      summary.value = summaryData
      series.value = seriesData.series
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : 'Failed to load bridge flows'
    } finally {
      loading.value = false
    }
  }

  // Clicking the active chain again clears the scope (toggle).
  function setChainScope(chain: string) {
    chainScope.value = chainScope.value === chain ? null : chain
  }
  function clearScope() {
    chainScope.value = null
  }

  function sortRoutes(key: string) {
    routeSort.value = toggleSort(routeSort.value, key)
  }
  function sortFlows(key: string) {
    flowSort.value = toggleSort(flowSort.value, key)
  }

  // Stat strip — scoped to the active chain when set, else the window totals.
  const totals = computed<{ inflowUsd: number; outflowUsd: number; netUsd: number }>(() => {
    const s = summary.value
    if (!s) return { inflowUsd: 0, outflowUsd: 0, netUsd: 0 }
    if (!chainScope.value) {
      return { inflowUsd: s.inflow.totalUsd, outflowUsd: s.outflow.totalUsd, netUsd: s.netUsd }
    }
    const inflowUsd = s.inflow.byChain.find((c) => c.chain === chainScope.value)?.amountUsd ?? 0
    const outflowUsd = s.outflow.byChain.find((c) => c.chain === chainScope.value)?.amountUsd ?? 0
    return { inflowUsd, outflowUsd, netUsd: inflowUsd - outflowUsd }
  })

  // Client-bucket the recent feed into CHART_BUCKETS columns over the window,
  // optionally filtered to one chain. Shared by the 24h + chain-scoped paths.
  function bucketFlows(chain: string | null): BridgeBucket[] {
    const span = WINDOW_MS[window.value]
    const end = Date.now()
    const start = end - span
    const bucketMs = span / CHART_BUCKETS

    const inflow = new Array(CHART_BUCKETS).fill(0)
    const outflow = new Array(CHART_BUCKETS).fill(0)
    for (const f of rawFlows.value) {
      if (chain && f.chain !== chain) continue
      const ts = new Date(f.occurredAt).getTime()
      if (!Number.isFinite(ts) || ts < start || ts > end) continue
      const idx = Math.min(CHART_BUCKETS - 1, Math.max(0, Math.floor((ts - start) / bucketMs)))
      if (f.direction === 'outflow') outflow[idx] += num(f.amountUsd)
      else inflow[idx] += num(f.amountUsd)
    }
    let run = 0
    return inflow.map((inUsd, i) => {
      run += inUsd - outflow[i]
      return { inflow: inUsd, outflow: outflow[i], net: run, centerTs: start + (i + 0.5) * bucketMs }
    })
  }

  const buckets = computed<BridgeBucket[]>(() => {
    // Unscoped 7d/30d: authoritative daily series (gap-filled, all chains).
    if (!chainScope.value && window.value !== '24h') {
      let run = 0
      return series.value.map((pt) => {
        run += pt.inflowUsd - pt.outflowUsd
        return {
          inflow: pt.inflowUsd,
          outflow: pt.outflowUsd,
          net: run,
          centerTs: dayCenterTs(pt.day),
        }
      })
    }
    // 24h or chain-scoped: client-bucket the recent feed.
    return bucketFlows(chainScope.value)
  })

  // Days since the freshest bridge flow, from the window-independent recent feed
  // (not summary.lastFlowAt, which is null once flows fall outside the active
  // window). Drives the staleness banner. null = no flows at all -> banner hidden.
  const daysSinceLastFlow = computed<number | null>(() =>
    daysSinceLastFlowOf(rawFlows.value),
  )

  const routes = computed<BridgeRouteRow[]>(() => {
    const s = summary.value
    if (!s) return []
    const inflowByChain = new Map(s.inflow.byChain.map((c) => [c.chain, c.amountUsd]))
    const outflowByChain = new Map(s.outflow.byChain.map((c) => [c.chain, c.amountUsd]))
    const chains = [...new Set([...inflowByChain.keys(), ...outflowByChain.keys()])].filter(
      (c): c is string => !!c
    )
    const totalInflow = s.inflow.totalUsd || 0
    const rows: BridgeRouteRow[] = chains.map((chain) => {
      const inflowUsd = inflowByChain.get(chain) ?? 0
      const outflowUsd = outflowByChain.get(chain) ?? 0
      return {
        chain,
        ...chainStyle(chain),
        inflowUsd,
        outflowUsd,
        netUsd: inflowUsd - outflowUsd,
        share: totalInflow > 0 ? (inflowUsd / totalInflow) * 100 : 0,
      }
    })
    return sortBy(rows, routeSort.value, {
      chain: (r) => r.chain,
      inflow: (r) => r.inflowUsd,
      outflow: (r) => r.outflowUsd,
      net: (r) => r.netUsd,
      share: (r) => r.share,
    })
  })

  const flows = computed<BridgeFlowRow[]>(() => {
    const scope = chainScope.value
    const rows: BridgeFlowRow[] = rawFlows.value
      .filter((f) => !scope || f.chain === scope)
      .map((f, i) => {
        const chain = f.chain ?? 'Unknown'
        const dir: 'in' | 'out' = f.direction === 'inflow' ? 'in' : 'out'
        return {
          id: `${f.txHash}-${f.direction}-${i}`,
          chain,
          ...chainStyle(chain),
          dir,
          asset: f.token ?? 'USDC',
          amountUsd: num(f.amountUsd),
          occurredAt: f.occurredAt,
          txHash: f.txHash,
        }
      })
    return sortBy(rows, flowSort.value, {
      chain: (f) => f.chain,
      dir: (f) => f.dir,
      asset: (f) => f.asset,
      amount: (f) => f.amountUsd,
      time: (f) => new Date(f.occurredAt).getTime(),
      tx: (f) => f.txHash,
    })
  })

  onMounted(load)

  return {
    // state
    window,
    chainScope,
    loading,
    error,
    routeSort,
    flowSort,
    // view models
    summary,
    totals,
    buckets,
    routes,
    flows,
    daysSinceLastFlow,
    // actions
    load,
    refresh: load,
    setWindow,
    setChainScope,
    clearScope,
    sortRoutes,
    sortFlows,
  }
}
