// apps/web/src/api/notifications.ts
//
// Thin typed client over the D2 notifications read API, mirroring api/bridge.ts +
// api/wallets.ts (userId injected explicitly and serialized into the query).
// The back end is frozen & validated:
//   GET  /v1/notifications?userId=&limit=&before=   -> { count, notifications[] }
//   GET  /v1/notifications/unread-count?userId=      -> { count }
//   POST /v1/notifications/:id/read?userId=          -> { read, id, alreadyRead }
//   POST /v1/notifications/read-all?userId=          -> { read, count }

import { apiFetch } from './client'

export type NotificationKind = 'alert_fired' | 'alert_resolved'

// Machine-grade payload baked at fire time (poolLabel is the human label, e.g.
// "Blend Fixed"; value keeps full HF precision).
export interface NotificationPayload {
  walletId?: string
  poolEntityId?: string
  poolLabel?: string
  metric?: string
  value?: number | null
  threshold?: number | null
  operator?: string
}

// Matches the back DTO (mapNotification): title/body are already human-readable.
export interface AppNotification {
  id: string
  userId: string
  ruleId: string | null
  kind: NotificationKind
  title: string
  body: string | null
  payload: NotificationPayload | null
  readAt: string | null
  createdAt: string
}

export interface NotificationsResponse {
  count: number
  notifications: AppNotification[]
}

export interface UnreadCountResponse {
  count: number
}

export async function fetchNotifications(
  userId: string,
  options: { limit?: number; before?: string } = {}
): Promise<NotificationsResponse> {
  const params = new URLSearchParams({ userId })
  if (options.limit) params.set('limit', String(options.limit))
  if (options.before) params.set('before', options.before)
  return apiFetch<NotificationsResponse>(`/notifications?${params.toString()}`)
}

export async function fetchUnreadCount(
  userId: string
): Promise<UnreadCountResponse> {
  const params = new URLSearchParams({ userId })
  return apiFetch<UnreadCountResponse>(
    `/notifications/unread-count?${params.toString()}`
  )
}

export async function markNotificationRead(
  userId: string,
  id: string
): Promise<void> {
  const params = new URLSearchParams({ userId })
  await apiFetch<{ read: boolean }>(
    `/notifications/${id}/read?${params.toString()}`,
    { method: 'POST' }
  )
}

export async function markAllNotificationsRead(
  userId: string
): Promise<void> {
  const params = new URLSearchParams({ userId })
  await apiFetch<{ read: boolean; count: number }>(
    `/notifications/read-all?${params.toString()}`,
    { method: 'POST' }
  )
}
