// apps/web/src/api/alertRules.ts
//
// Typed client over the D2 rule-CRUD endpoints (userId-scoped; 404 if not owned),
// mirroring api/notifications.ts. The back end is frozen & validated.
//   POST   /v1/alert-rules?userId=
//   GET    /v1/alert-rules?userId=        -> AlertRule[]
//   GET    /v1/alert-rules/:id?userId=
//   PATCH  /v1/alert-rules/:id?userId=
//   DELETE /v1/alert-rules/:id?userId=    -> { deleted, id }

import { apiFetch } from './client'

export type AlertOperator = 'lt' | 'lte' | 'gt' | 'gte'

// Lot N: evaluated families — wallet health-factor, asset price, pool TVL drop.
export type AlertRuleMetric = 'health_factor' | 'price' | 'tvl_drop_pct'

// Matches the back DTO (mapRule).
export interface AlertRule {
  id: string
  userId: string
  metric: AlertRuleMetric
  userWalletId: string | null // null = all wallets (health_factor family)
  poolEntityId: string | null // null = all pools (health_factor family)
  assetId: string | null // price family subject
  operator: AlertOperator
  threshold: number | null
  cooldownSeconds: number
  rearmHysteresis: number | null
  enabled: boolean
  extra: unknown
  createdAt: string
  updatedAt: string
}

export interface CreateAlertRuleInput {
  metric: AlertRuleMetric
  operator: AlertOperator
  threshold: number
  userWalletId?: string | null
  poolEntityId?: string | null
  assetId?: string | null
  cooldownSeconds?: number
  rearmHysteresis?: number | null
  enabled?: boolean
}

// GET /v1/alert-rules/priced-assets — the vetted list for price rules (assets
// the pipeline actually prices, with the latest observation for freshness).
export interface PricedAsset {
  assetId: string
  symbol: string | null
  name: string | null
  priceUsd: number | null
  observedAt: string
}

export async function fetchPricedAssets(): Promise<{
  count: number
  assets: PricedAsset[]
}> {
  return apiFetch<{ count: number; assets: PricedAsset[] }>(
    '/alert-rules/priced-assets'
  )
}

// GET /v1/alert-rules/tvl-pools — pools eligible for TVL-drop rules (N3):
// active entities with reserve-batch history on the live refresh path.
export interface TvlPool {
  entityId: string
  slug: string | null
  name: string
  venueName: string | null
}

export async function fetchTvlPools(): Promise<{
  count: number
  pools: TvlPool[]
}> {
  return apiFetch<{ count: number; pools: TvlPool[] }>('/alert-rules/tvl-pools')
}

export type UpdateAlertRuleInput = Partial<CreateAlertRuleInput>

export async function listAlertRules(userId: string): Promise<AlertRule[]> {
  const q = new URLSearchParams({ userId }).toString()
  return apiFetch<AlertRule[]>(`/alert-rules?${q}`)
}

export async function createAlertRule(
  userId: string,
  input: CreateAlertRuleInput
): Promise<AlertRule> {
  const q = new URLSearchParams({ userId }).toString()
  return apiFetch<AlertRule>(`/alert-rules?${q}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updateAlertRule(
  userId: string,
  id: string,
  patch: UpdateAlertRuleInput
): Promise<AlertRule> {
  const q = new URLSearchParams({ userId }).toString()
  return apiFetch<AlertRule>(`/alert-rules/${id}?${q}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function deleteAlertRule(
  userId: string,
  id: string
): Promise<{ deleted: boolean; id: string }> {
  const q = new URLSearchParams({ userId }).toString()
  return apiFetch<{ deleted: boolean; id: string }>(`/alert-rules/${id}?${q}`, {
    method: 'DELETE',
  })
}
