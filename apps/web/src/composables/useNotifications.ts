// apps/web/src/composables/useNotifications.ts
//
// Shared notifications logic for D2. The bell uses it now; the future Alerts page
// will reuse the same module-scoped state (one source of truth across consumers,
// like useAppUser.ts).
//
// POLLING: a SINGLE setInterval polls only the unread COUNT (~45s). It is started
// on the first consumer mount and cleared on the last unmount via mount ref-count,
// so N consumers never spawn N timers. The full list is NOT polled — it loads on
// dropdown open. This is the app's first background poller; the ref-count is the
// thing that must be correct.

import { onMounted, onUnmounted, ref } from 'vue'
import { useAppUser } from './useAppUser'
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '../api/notifications'

const POLL_INTERVAL_MS = 45_000
const LIST_LIMIT = 20

// --- module-scoped shared state (declared once, shared by every caller) ---
const notifications = ref<AppNotification[]>([])
const unreadCount = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
// true while the last page returned a full batch (more history may exist). Used
// by the Alerts page "Load more"; the bell ignores it.
const hasMore = ref(true)

// --- single-poller bookkeeping ---
let pollTimer: ReturnType<typeof setInterval> | null = null
let mountCount = 0

export function useNotifications() {
  const { userId } = useAppUser()

  function currentUserId(): string | null {
    const id = userId.value?.trim()
    return id && id.length ? id : null
  }

  // Load the recent list (dropdown open / page view). Sets loading + error.
  async function load(): Promise<void> {
    const id = currentUserId()
    if (!id) {
      notifications.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      const res = await fetchNotifications(id, { limit: LIST_LIMIT })
      notifications.value = res.notifications
      hasMore.value = res.notifications.length >= LIST_LIMIT
    } catch (e) {
      error.value =
        e instanceof Error ? e.message : 'Failed to load notifications'
    } finally {
      loading.value = false
    }
  }

  // Append the next older page using the `before` keyset cursor (created_at <
  // oldest loaded). Used by the Alerts page; appends to the shared list so the
  // bell's "latest 8" view stays correct.
  async function loadMore(): Promise<void> {
    const id = currentUserId()
    if (!id || !hasMore.value) return
    const oldest = notifications.value[notifications.value.length - 1]
    if (!oldest) {
      await load()
      return
    }
    loading.value = true
    error.value = null
    try {
      const res = await fetchNotifications(id, {
        limit: LIST_LIMIT,
        before: oldest.createdAt,
      })
      notifications.value = [...notifications.value, ...res.notifications]
      hasMore.value = res.notifications.length >= LIST_LIMIT
    } catch (e) {
      error.value =
        e instanceof Error ? e.message : 'Failed to load notifications'
    } finally {
      loading.value = false
    }
  }

  // Badge-only refresh. Silent by design — a background poll must never surface a
  // transient error in the UI.
  async function refreshUnreadCount(): Promise<void> {
    const id = currentUserId()
    if (!id) {
      unreadCount.value = 0
      return
    }
    try {
      const res = await fetchUnreadCount(id)
      unreadCount.value = res.count
    } catch {
      /* swallow: keep the last known count */
    }
  }

  // Optimistic single mark-read: flip locally first, roll back on failure.
  async function markAsRead(notificationId: string): Promise<void> {
    const id = currentUserId()
    if (!id) return
    const target = notifications.value.find((n) => n.id === notificationId)
    if (!target || target.readAt) return // absent or already read -> no-op

    const prevReadAt = target.readAt
    target.readAt = new Date().toISOString()
    unreadCount.value = Math.max(0, unreadCount.value - 1)

    try {
      await markNotificationRead(id, notificationId)
    } catch (e) {
      target.readAt = prevReadAt
      unreadCount.value += 1
      error.value = e instanceof Error ? e.message : 'Failed to mark as read'
    }
  }

  // Optimistic mark-all: snapshot for rollback, flip everything, reset badge.
  async function markAllAsRead(): Promise<void> {
    const id = currentUserId()
    if (!id) return

    const snapshot = notifications.value.map((n) => n.readAt)
    const prevUnread = unreadCount.value
    const nowIso = new Date().toISOString()
    notifications.value.forEach((n) => {
      if (!n.readAt) n.readAt = nowIso
    })
    unreadCount.value = 0

    try {
      await markAllNotificationsRead(id)
    } catch (e) {
      notifications.value.forEach((n, i) => {
        n.readAt = snapshot[i]
      })
      unreadCount.value = prevUnread
      error.value = e instanceof Error ? e.message : 'Failed to mark all as read'
    }
  }

  // Mount ref-count: only the first consumer starts the poller, only the last
  // stops it.
  onMounted(() => {
    mountCount += 1
    if (mountCount === 1) {
      void refreshUnreadCount() // immediate first count
      if (!pollTimer) {
        pollTimer = setInterval(() => {
          void refreshUnreadCount()
        }, POLL_INTERVAL_MS)
      }
    }
  })

  onUnmounted(() => {
    mountCount = Math.max(0, mountCount - 1)
    if (mountCount === 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  })

  return {
    // state
    notifications,
    unreadCount,
    loading,
    error,
    hasMore,
    // actions
    load,
    loadMore,
    refreshUnreadCount,
    markAsRead,
    markAllAsRead,
  }
}
