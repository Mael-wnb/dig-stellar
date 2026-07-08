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
import { useAppUser } from './useAppUser'
import { useAlertRules } from './useAlertRules'
import { useNotifications } from './useNotifications'
import { fetchWalletOverview } from '../api/wallets'
import type { WalletItem } from '../types/wallet'
import type {
  AlertRule as BackendRule,
  AlertOperator as BackendOperator,
  CreateAlertRuleInput,
} from '../api/alertRules'
import type { AppNotification } from '../api/notifications'

export type AlertScope = 'venue' | 'wallet' | 'protocol'
export type AlertMetric =
  | 'apy' | 'tvl' | 'util' | 'netflow' | 'price'          // venue
  | 'balance' | 'exposure' | 'health' | 'posvalue'        // wallet
  | 'volume'                                              // protocol
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

// ── Scope discipline (T2-D2) ────────────────────────────────────────────────
// The engine only evaluates the wallet health-factor family today. The builder
// still shows the full vision (Paul's design), but non-supported combinations are
// flagged "soon" and cannot be created, so the product never implies an alert
// fires when the backend won't evaluate it. Expand this set as families ship.
export const SUPPORTED_METRICS: Record<AlertScope, Set<AlertMetric>> = {
  wallet: new Set<AlertMetric>(['health']),
  venue: new Set<AlertMetric>([]),
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
  if (n.metric === 'apy' || n.metric === 'volume' || n.metric === 'tvl') return 'trend'
  if (n.metric === 'netflow') return 'drop'
  if (n.metric === 'balance' || n.metric === 'exposure' || n.metric === 'posvalue') return 'wallet'
  return 'bell'
}

const METRIC_KEY: Record<AlertMetric, string> = {
  apy: 'apy', tvl: 'tvl', util: 'utilization', netflow: 'netflow_1h', price: 'price',
  balance: 'balance_change', exposure: 'net_exposure', health: 'health_factor',
  posvalue: 'position_value', volume: 'volume_24h',
}
const OP_SYMBOL: Record<AlertOperator, string> = { lt: '<', gt: '>', pct: 'Δ' }

/** Mono condition string, e.g. "health_factor < 1.25 · Blend USDC". */
export function conditionLabel(r: Pick<AlertRule, 'metric' | 'operator' | 'threshold' | 'scope_ref' | 'condition'>): string {
  if (r.condition) return r.condition
  return `${METRIC_KEY[r.metric]} ${OP_SYMBOL[r.operator]} ${r.threshold} · ${r.scope_ref}`
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

/** Stateful composable used by AlertsView (+ shared with the header bell). */
export function useAlerts() {
  const { userId } = useAppUser()
  const {
    rules: backendRules,
    load: loadRules,
    createRule: createBackendRule,
    toggleRule: toggleBackendRule,
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

  // scope_ref display for a rule: the wallet's label, or "All wallets" when the rule
  // spans every wallet (userWalletId === null).
  function scopeRefLabel(userWalletId: string | null): string {
    if (!userWalletId) return 'All wallets'
    return walletLabelById.value.get(userWalletId) ?? `${userWalletId.slice(0, 8)}…`
  }

  const rules = computed<AlertRule[]>(() =>
    backendRules.value.map((r: BackendRule): AlertRule => {
      const label = scopeRefLabel(r.userWalletId)
      const threshold = r.threshold ?? 0
      const sym = BACKEND_OP_SYMBOL[r.operator]
      return {
        id: r.id,
        name: `${label} · Health factor`,
        scope: 'wallet',
        scope_ref: label,
        metric: 'health',
        operator: toViewOperator(r.operator),
        threshold,
        severity: severityForThreshold(r.threshold),
        enabled: r.enabled,
        condition: `health_factor ${sym} ${threshold} · ${label}`,
      }
    }),
  )

  const feed = computed<AlertNotification[]>(() =>
    notifications.value.map((n: AppNotification): AlertNotification => {
      const fired = n.kind === 'alert_fired'
      return {
        id: n.id,
        title: n.title,
        body: n.body ?? '',
        scope_ref: n.payload?.poolLabel ?? undefined,
        severity: fired ? 'critical' : 'info',
        category: fired ? 'critical' : 'activity',
        metric: 'health',
        created_at: n.createdAt,
        acknowledged_at: n.readAt,
      }
    }),
  )

  async function load() {
    loading.value = true
    error.value = null
    try {
      await Promise.all([loadRules(), loadNotifications(), loadWallets()])
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to load alerts'
    } finally {
      loading.value = false
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
    // The modal only lets the supported family (wallet · health) through, but guard
    // anyway so a future widening can't silently POST an unsupported metric.
    if (!isSupported(payload.scope, payload.metric)) {
      throw new Error('This alert type is not evaluated by the engine yet.')
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

  return { rules, feed, wallets, loading, error, load, createRule, toggleRule }
}
