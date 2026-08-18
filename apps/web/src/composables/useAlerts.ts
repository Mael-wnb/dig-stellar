// apps/web/src/composables/useAlerts.ts
//
// View-model adapter for the Alerts feature (SCF T2-D2). Presents the shape Paul's
// design consumes (AlertsView.vue + AlertRuleModal.vue) on top of the REAL, frozen
// backend contract.
//
// Reconciliation note (Claude Code):
//   The backend only evaluates ONE rule family today — `health_factor` — and its
//   DTOs are camelCase and leaner than the mock assumed (no name/severity/scope_ref
//   on rules; notifications use readAt/kind, not acknowledged_at/category). So this
//   file no longer talks to the network itself. It DELEGATES to the house-style
//   composables that already speak the real contract:
//     - useAlertRules  -> GET/POST/PATCH /v1/alert-rules   (api/alertRules.ts)
//     - useNotifications-> GET /v1/notifications           (api/notifications.ts)
//   and MAPS their DTOs into the view models below. Because useNotifications is
//   module-scoped, the Alerts page and the header bell share ONE source of truth.
//
// The public surface (rules, feed, loading, error, load, createRule, toggleRule,
// wallets) is unchanged, so the .vue components did not move. All the display
// helpers (conditionLabel, timeAgo, SEVERITY_STYLE, metricIconKey, SUPPORTED_METRICS)
// are preserved verbatim — only the data layer under them was rewired.

import { computed, ref } from 'vue'
import { displayPoolName } from '../utils/format'
import { useAppUser } from './useAppUser'
import { useAlertRules } from './useAlertRules'
import { useNotifications } from './useNotifications'
import { fetchWalletOverview } from '../api/wallets'
import type { WalletItem } from '../types/wallet'
import {
  fetchApyPools,
  fetchPricedAssets,
  fetchTvlPools,
  type AlertRule as BackendRule,
  type AlertOperator as BackendOperator,
  type ApyPool,
  type CreateAlertRuleInput,
  type PricedAsset,
  type TvlPool,
} from '../api/alertRules'
import type { AppNotification, NotificationLink } from '../api/notifications'

export type AlertScope = 'venue' | 'wallet' | 'protocol' | 'asset'
export type AlertMetric =
  | 'apy' | 'borrowapy' | 'tvl' | 'util' | 'netflow'      // venue
  | 'balance' | 'exposure' | 'health' | 'posvalue'        // wallet
  | 'volume'                                              // protocol
  | 'price'                                               // asset
export type AlertOperator = 'lt' | 'gt' | 'pct'
export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface AlertRule {
  id: string
  name: string
  scope: AlertScope
  scope_ref: string            // venue slug / wallet address / protocol slug
  metric: AlertMetric
  operator: AlertOperator
  threshold: number
  severity: AlertSeverity
  enabled: boolean
  condition?: string           // optional server-provided human string; we derive one if absent
}

export interface AlertNotification {
  id: string
  title: string
  body: string
  scope_ref?: string           // e.g. "Blend · USDC Lending"
  severity: AlertSeverity
  category?: 'critical' | 'activity'
  metric?: AlertMetric
  created_at: string           // ISO
  acknowledged_at?: string | null
  link?: NotificationLink      // deep-link to the notification's subject
}

export interface CreateRulePayload {
  name: string
  scope: AlertScope
  scope_ref: string
  metric: AlertMetric
  operator: AlertOperator
  threshold: number
  severity: AlertSeverity
}

// ── Scope discipline (T2-D2, widened by Lot N) ──────────────────────────────
// The engine evaluates two families today: wallet health-factor and asset
// price (N1). The builder still shows the full vision (Paul's design), but
// non-supported combinations are flagged "soon" and cannot be created, so the
// product never implies an alert fires when the backend won't evaluate it.
export const SUPPORTED_METRICS: Record<AlertScope, Set<AlertMetric>> = {
  wallet: new Set<AlertMetric>(['health']),
  asset: new Set<AlertMetric>(['price']),
  venue: new Set<AlertMetric>(['tvl', 'apy', 'borrowapy']),
  protocol: new Set<AlertMetric>([]),
}
export function isSupported(scope: AlertScope, metric: AlertMetric): boolean {
  return SUPPORTED_METRICS[scope]?.has(metric) ?? false
}

// ── Display helpers (colors match Paul's palette exactly) ───────────────────
export const SEVERITY_STYLE: Record<AlertSeverity, { color: string; tint: string; dot: string }> = {
  critical: { color: '#D0522E', tint: '#371C16', dot: '#D0522E' },
  warning: { color: '#C98A1E', tint: '#34290F', dot: '#C98A1E' },
  info: { color: '#2E9E63', tint: '#12301F', dot: '#2E9E63' },
}

export function metricIconKey(n: { metric?: AlertMetric; category?: string }): string {
  if (n.category === 'critical' || n.metric === 'health') return 'heart'
  if (n.metric === 'apy' || n.metric === 'borrowapy' || n.metric === 'volume' || n.metric === 'tvl' || n.metric === 'price') return 'trend'
  if (n.metric === 'netflow') return 'drop'
  if (n.metric === 'balance' || n.metric === 'exposure' || n.metric === 'posvalue') return 'wallet'
  return 'bell'
}

const METRIC_KEY: Record<AlertMetric, string> = {
  apy: 'supply_apy', borrowapy: 'borrow_apy', tvl: 'tvl', util: 'utilization',
  netflow: 'netflow_1h', price: 'price',
  balance: 'balance_change', exposure: 'net_exposure', health: 'health_factor',
  posvalue: 'position_value', volume: 'volume_24h',
}
const OP_SYMBOL: Record<AlertOperator, string> = { lt: '<', gt: '>', pct: 'Δ' }

/** Mono condition string, e.g. "health_factor < 1.25 · Blend USDC". */
export function conditionLabel(r: Pick<AlertRule, 'metric' | 'operator' | 'threshold' | 'scope_ref' | 'condition'>): string {
  if (r.condition) return r.condition
  return `${METRIC_KEY[r.metric]} ${OP_SYMBOL[r.operator]} ${r.threshold} - ${r.scope_ref}`
}

export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Backend <-> view mapping ────────────────────────────────────────────────
// Only `health_factor` exists today, so scope is always 'wallet' / metric 'health'.

// Exact condition-string symbol (keeps lte/gte's "=" that the 3-op view type drops).
const BACKEND_OP_SYMBOL: Record<BackendOperator, string> = {
  lt: '<', lte: '≤', gt: '>', gte: '≥',
}

// Collapse the backend's 4 operators onto the view's 3 (lt/gt/pct). lte→lt, gte→gt
// for the toggle direction; the precise symbol is preserved in `condition`.
function toViewOperator(op: BackendOperator): AlertOperator {
  return op === 'gt' || op === 'gte' ? 'gt' : 'lt'
}

// Only lt/gt are meaningful for a health-factor threshold; the view's `pct` has no
// backend equivalent, so it defaults to lt ("falls below") — the sensible HF case.
function toBackendOperator(op: AlertOperator): BackendOperator {
  return op === 'gt' ? 'gt' : 'lt'
}

// Health-factor severity is derived from the threshold (there is no severity column
// on the rule): closer to the 1.0 liquidation line = more urgent. Display-only.
function severityForThreshold(threshold: number | null): AlertSeverity {
  if (threshold === null || !Number.isFinite(threshold)) return 'warning'
  if (threshold <= 1.05) return 'critical'
  if (threshold <= 1.3) return 'warning'
  return 'info'
}

// assets.symbol stores the Stellar-native lumen as 'native'; display it as XLM.
export function assetDisplaySymbol(a: Pick<PricedAsset, 'symbol' | 'name' | 'assetId'>): string {
  const s = (a.symbol ?? '').trim()
  if (s === 'native') return 'XLM'
  if (s) return s
  return (a.name ?? '').trim() || `${a.assetId.slice(0, 8)}…`
}

// USD price display: >= $1 → 2 decimals, sub-dollar → 4 (matches the API copy).
export function formatUsdPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return Math.abs(value) >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`
}

/** Stateful composable used by AlertsView (+ shared with the header bell). */
export function useAlerts() {
  const { userId } = useAppUser()
  const {
    rules: backendRules,
    load: loadRules,
    createRule: createBackendRule,
    toggleRule: toggleBackendRule,
    deleteRule: deleteBackendRule,
  } = useAlertRules()
  const {
    notifications,
    load: loadNotifications,
  } = useNotifications()

  const loading = ref(false)
  const error = ref<string | null>(null)

  // Wallet directory (id ↔ address ↔ label) so we can label rules that reference a
  // wallet by UUID and resolve the modal's address selection back to a UUID on
  // create. Fetched via the lightweight overview (one request, no per-wallet fan-out).
  const walletItems = ref<WalletItem[]>([])
  const wallets = computed(() =>
    walletItems.value.map((w) => ({ address: w.address, label: w.label })),
  )
  const walletLabelById = computed(() => {
    const m = new Map<string, string>()
    for (const w of walletItems.value) m.set(w.id, w.label || w.address)
    return m
  })
  const walletIdByAddress = computed(() => {
    const m = new Map<string, string>()
    for (const w of walletItems.value) m.set(w.address, w.id)
    return m
  })

  // Priced-asset directory (Lot N): the vetted list for price rules, also used
  // to label existing price rules by symbol.
  const pricedAssets = ref<PricedAsset[]>([])
  const assets = computed(() =>
    pricedAssets.value.map((a) => ({
      id: a.assetId,
      label: assetDisplaySymbol(a),
      sub: formatUsdPrice(a.priceUsd),
    })),
  )
  const assetById = computed(() => {
    const m = new Map<string, PricedAsset>()
    for (const a of pricedAssets.value) m.set(a.assetId, a)
    return m
  })

  // Pool directories (N3/N4): TVL-eligible pools are the venue-scope target
  // list; APY eligibility (per side) is merged in as flags so the modal can
  // gate APY metrics per target. Also used to label existing rules.
  const tvlPools = ref<TvlPool[]>([])
  const apyPools = ref<ApyPool[]>([])
  const apyPoolById = computed(() => {
    const m = new Map<string, ApyPool>()
    for (const p of apyPools.value) m.set(p.entityId, p)
    return m
  })
  const pools = computed(() =>
    tvlPools.value.map((p) => {
      const apy = apyPoolById.value.get(p.entityId)
      return {
        id: p.entityId,
        // Q2: pool names may carry the internal 'native' symbol — display-map it.
        label: p.venueName ? `${p.venueName} ${displayPoolName(p.name)}` : displayPoolName(p.name),
        sub: p.venueName ?? '',
        apy: apy != null && apy.supplyApy !== null,
        borrowApy: apy != null && apy.borrowApy !== null,
      }
    }),
  )
  const poolById = computed(() => {
    const m = new Map<string, TvlPool>()
    for (const p of tvlPools.value) m.set(p.entityId, p)
    return m
  })

  // scope_ref display for a rule: the wallet's label, or "All wallets" when the rule
  // spans every wallet (userWalletId === null).
  function scopeRefLabel(userWalletId: string | null): string {
    if (!userWalletId) return 'All wallets'
    return walletLabelById.value.get(userWalletId) ?? `${userWalletId.slice(0, 8)}…`
  }

  const rules = computed<AlertRule[]>(() =>
    backendRules.value.map((r: BackendRule): AlertRule => {
      const threshold = r.threshold ?? 0
      const sym = BACKEND_OP_SYMBOL[r.operator]

      if (r.metric === 'price') {
        const asset = r.assetId ? assetById.value.get(r.assetId) : undefined
        const label = asset
          ? assetDisplaySymbol(asset)
          : `${(r.assetId ?? '').slice(0, 8)}…`
        return {
          id: r.id,
          name: `${label} - Price`,
          scope: 'asset',
          scope_ref: label,
          metric: 'price',
          operator: toViewOperator(r.operator),
          threshold,
          severity: 'info',
          enabled: r.enabled,
          condition: `price ${sym} ${formatUsdPrice(threshold)} - ${label}`,
        }
      }

      if (r.metric === 'tvl_drop_pct') {
        const pool = r.poolEntityId ? poolById.value.get(r.poolEntityId) : undefined
        const label = pool
          ? (pool.venueName ? `${pool.venueName} ${pool.name}` : pool.name)
          : `${(r.poolEntityId ?? '').slice(0, 8)}…`
        return {
          id: r.id,
          name: `${label} - TVL drop`,
          scope: 'venue',
          scope_ref: label,
          metric: 'tvl',
          operator: toViewOperator(r.operator),
          threshold,
          severity: 'warning',
          enabled: r.enabled,
          condition: `tvl_drop ${sym} ${threshold}% / 24h - ${label}`,
        }
      }

      if (r.metric === 'supply_apy' || r.metric === 'borrow_apy') {
        const pool = r.poolEntityId ? poolById.value.get(r.poolEntityId) : undefined
        const label = pool
          ? (pool.venueName ? `${pool.venueName} ${pool.name}` : pool.name)
          : `${(r.poolEntityId ?? '').slice(0, 8)}…`
        const isSupply = r.metric === 'supply_apy'
        return {
          id: r.id,
          name: `${label} - ${isSupply ? 'Supply' : 'Borrow'} APY`,
          scope: 'venue',
          scope_ref: label,
          metric: isSupply ? 'apy' : 'borrowapy',
          operator: toViewOperator(r.operator),
          threshold,
          severity: 'info',
          enabled: r.enabled,
          condition: `${r.metric} ${sym} ${threshold}% - ${label}`,
        }
      }

      const label = scopeRefLabel(r.userWalletId)
      return {
        id: r.id,
        name: `${label} - Health factor`,
        scope: 'wallet',
        scope_ref: label,
        metric: 'health',
        operator: toViewOperator(r.operator),
        threshold,
        severity: severityForThreshold(r.threshold),
        enabled: r.enabled,
        condition: `health_factor ${sym} ${threshold} - ${label}`,
      }
    }),
  )

  const feed = computed<AlertNotification[]>(() =>
    notifications.value.map((n: AppNotification): AlertNotification => {
      const fired = n.kind === 'alert_fired'
      const payloadMetric = n.payload?.metric
      // Severity/category derived from the payload: a health-factor fire is a
      // risk event (critical); a pool-status degradation is a protection event
      // (warning, surfaced under Critical); a price crossing is informational.
      let severity: AlertSeverity = 'info'
      let category: 'critical' | 'activity' = 'activity'
      let metric: AlertMetric | undefined = 'health'
      if (payloadMetric === 'price') {
        metric = 'price'
      } else if (payloadMetric === 'supply_apy' || payloadMetric === 'borrow_apy') {
        // The opportunity family — informational either way (lowest criticality).
        metric = payloadMetric === 'supply_apy' ? 'apy' : 'borrowapy'
      } else if (payloadMetric === 'tvl_drop_pct') {
        metric = 'tvl' // trend icon
        if (fired) {
          severity = 'warning'
          category = 'critical'
        }
      } else if (payloadMetric === 'pool_status') {
        metric = undefined // bell icon — pool status is not a rule metric
        if (fired) {
          severity = 'warning'
          category = 'critical'
        }
      } else if (fired) {
        severity = 'critical'
        category = 'critical'
      }
      return {
        id: n.id,
        title: n.title,
        body: n.body ?? '',
        scope_ref: n.payload?.poolLabel ?? n.payload?.symbol ?? undefined,
        severity,
        category,
        metric,
        created_at: n.createdAt,
        acknowledged_at: n.readAt,
        link: n.payload?.link,
      }
    }),
  )

  async function load() {
    loading.value = true
    error.value = null
    try {
      await Promise.all([loadRules(), loadNotifications(), loadWallets(), loadAssets(), loadPools()])
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to load alerts'
    } finally {
      loading.value = false
    }
  }

  async function loadAssets() {
    try {
      const data = await fetchPricedAssets()
      pricedAssets.value = data.assets ?? []
    } catch {
      // non-fatal: price rules render with a short-id label, the modal shows
      // an honest "no priced assets" state.
      pricedAssets.value = []
    }
  }

  async function loadPools() {
    try {
      const data = await fetchTvlPools()
      tvlPools.value = data.pools ?? []
    } catch {
      // non-fatal: tvl rules render with a short-id label, the modal shows an
      // honest empty state for the venue scope.
      tvlPools.value = []
    }
    try {
      const data = await fetchApyPools()
      apyPools.value = data.pools ?? []
    } catch {
      // non-fatal: APY metrics simply show as unavailable for every target.
      apyPools.value = []
    }
  }

  async function loadWallets() {
    const id = userId.value?.trim()
    if (!id) {
      walletItems.value = []
      return
    }
    try {
      const data = await fetchWalletOverview(id)
      walletItems.value = data.wallets ?? []
    } catch {
      // non-fatal: rules still render with a short-id fallback label.
      walletItems.value = []
    }
  }

  async function createRule(payload: CreateRulePayload) {
    // The modal only lets supported families through, but guard anyway so a
    // future widening can't silently POST an unsupported metric.
    if (!isSupported(payload.scope, payload.metric)) {
      throw new Error('This alert type is not evaluated by the engine yet.')
    }

    if (payload.scope === 'asset') {
      // scope_ref is the asset id from the vetted priced-assets list.
      const input: CreateAlertRuleInput = {
        metric: 'price',
        operator: toBackendOperator(payload.operator),
        threshold: payload.threshold,
        assetId: payload.scope_ref,
        userWalletId: null,
        poolEntityId: null,
        enabled: true,
      }
      await createBackendRule(input)
      return
    }

    if (payload.scope === 'venue' && (payload.metric === 'apy' || payload.metric === 'borrowapy')) {
      // scope_ref is the pool entity id. Threshold is in percent; direction is
      // the user's lt/gt choice (both are meaningful for an APY threshold).
      const input: CreateAlertRuleInput = {
        metric: payload.metric === 'apy' ? 'supply_apy' : 'borrow_apy',
        operator: toBackendOperator(payload.operator),
        threshold: payload.threshold,
        poolEntityId: payload.scope_ref,
        userWalletId: null,
        assetId: null,
        enabled: true,
      }
      await createBackendRule(input)
      return
    }

    if (payload.scope === 'venue' && payload.metric === 'tvl') {
      // scope_ref is the pool entity id from the vetted tvl-pools list. The
      // backend family is a DROP percentage — operator is always gte ("fires
      // when the 24h drop exceeds the threshold"), whatever the view showed.
      const input: CreateAlertRuleInput = {
        metric: 'tvl_drop_pct',
        operator: 'gte',
        threshold: payload.threshold,
        poolEntityId: payload.scope_ref,
        userWalletId: null,
        assetId: null,
        enabled: true,
      }
      await createBackendRule(input)
      return
    }

    // scope_ref is a wallet address, or the sentinel 'all' (⇒ all wallets ⇒ null).
    const userWalletId =
      payload.scope_ref === 'all'
        ? null
        : walletIdByAddress.value.get(payload.scope_ref) ?? null

    const input: CreateAlertRuleInput = {
      metric: 'health_factor',
      operator: toBackendOperator(payload.operator),
      threshold: payload.threshold,
      userWalletId,
      poolEntityId: null, // wallet scope spans all of that wallet's pools
      enabled: true,
    }
    await createBackendRule(input)
  }

  async function toggleRule(rule: AlertRule) {
    await toggleBackendRule(rule.id, !rule.enabled)
  }

  async function removeRule(rule: AlertRule) {
    await deleteBackendRule(rule.id)
  }

  return {
    rules, feed, wallets, assets, pools, loading, error,
    load, createRule, toggleRule, removeRule,
  }
}
