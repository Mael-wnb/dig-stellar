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

// Matches the back DTO (mapRule).
export interface AlertRule {
  id: string
  userId: string
  metric: 'health_factor'
  userWalletId: string | null // null = all wallets
  poolEntityId: string | null // null = all pools
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
  metric: 'health_factor'
  operator: AlertOperator
  threshold: number
  userWalletId?: string | null
  poolEntityId?: string | null
  cooldownSeconds?: number
  rearmHysteresis?: number | null
  enabled?: boolean
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
