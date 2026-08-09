<script setup lang="ts">
// NotificationsBell — Lot C. Restyled to the design's "Activity feed" dropdown
// (Dig Stellar.dc.html bell block). Data logic is unchanged: it drives the same
// shared useNotifications (unread count · list · mark-read/all). Presentation
// only — real notifications, honest empty/loading/error states.
import { computed, ref } from 'vue'
import { useNotifications } from '../composables/useNotifications'
import { useView } from '../composables/useView'
import { relativeTime } from '../utils/format'
import type { AppNotification } from '../api/notifications'

const { notifications, unreadCount, loading, error, load, markAsRead, markAllAsRead } =
  useNotifications()
const { setView } = useView()

const open = ref(false)
const hasUnread = computed(() => unreadCount.value > 0)
// The dropdown shows the latest few; the full history is the Alerts page.
const visible = computed(() => notifications.value.slice(0, 6))

// Map a notification kind → the design's icon tint/colour + left border.
function kindStyle(n: AppNotification): { tint: string; color: string; border: string } {
  if (n.kind === 'alert_fired') return { tint: '#371C16', color: '#D0522E', border: '#D0522E' }
  return { tint: '#12301F', color: '#2E9E63', border: '#2E9E63' }
}

function toggle() {
  open.value = !open.value
  if (open.value) void load()
}
function close() {
  open.value = false
}
function onRowClick(id: string) {
  void markAsRead(id)
}
function goAlerts() {
  open.value = false
  setView('alerts')
}
</script>

<template>
  <div class="relative">
    <!-- Bell button + unread dot -->
    <button
      type="button"
      aria-label="Notifications"
      class="dig-ghost relative w-[38px] h-[38px] rounded-[11px] flex items-center justify-center transition-colors"
      style="background: var(--dig-surface); border: 1px solid var(--dig-line); color: var(--dig-faint)"
      @click="toggle"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      <span
        v-if="hasUnread"
        class="absolute top-[8px] right-[9px] w-[7px] h-[7px] rounded-full"
        style="background: #E0603E; box-shadow: 0 0 0 2px var(--dig-surface)"
      />
    </button>

    <!-- Click-away backdrop -->
    <div v-if="open" class="fixed inset-0 z-[40]" @click="close" />

    <!-- Activity feed dropdown -->
    <div
      v-if="open"
      class="absolute right-0 mt-[10px] w-[380px] max-h-[520px] overflow-y-auto z-[50] dig-scroll"
      style="background: var(--dig-surface); border: 1px solid var(--dig-line); border-radius: 16px; box-shadow: 0 16px 48px rgba(0,0,0,0.5)"
    >
      <!-- header -->
      <div class="flex items-center px-[16px] py-[14px]" style="border-bottom: 1px solid var(--dig-line-soft)">
        <div class="text-[13.5px] font-bold">Activity feed</div>
        <span class="ml-[10px] text-[11.5px]" style="color: var(--dig-faint)">{{ unreadCount }} unread</span>
        <button
          v-if="hasUnread"
          type="button"
          class="dig-chip ml-auto text-[11.5px] font-semibold cursor-pointer px-[8px] py-[4px] rounded-[8px]"
          style="color: var(--dig-faint)"
          @click="markAllAsRead"
        >
          Mark all read
        </button>
      </div>

      <!-- states -->
      <div v-if="loading && !visible.length" class="px-[16px] py-[24px] text-center text-[13px]" style="color: var(--dig-faint)">Loading…</div>
      <div v-else-if="error && !visible.length" class="px-[16px] py-[24px] text-center text-[13px]" style="color: #E0603E">{{ error }}</div>
      <div v-else-if="!visible.length" class="px-[16px] py-[32px] text-center text-[13px]" style="color: var(--dig-faint)">No alerts yet</div>

      <!-- feed -->
      <button
        v-for="n in visible"
        :key="n.id"
        type="button"
        class="w-full text-left flex gap-[10px] px-[16px] py-[12px] cursor-pointer"
        :style="{
          borderBottom: '1px solid #262624',
          borderLeft: `3px solid ${kindStyle(n).border}`,
          background: n.readAt ? 'transparent' : 'rgba(213,255,47,0.03)',
        }"
        @click="onRowClick(n.id)"
      >
        <span
          class="w-[30px] h-[30px] flex-shrink-0 rounded-[9px] flex items-center justify-center"
          :style="{ background: kindStyle(n).tint, color: kindStyle(n).color }"
        >
          <svg v-if="n.kind === 'alert_fired'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </span>
        <div class="flex-1 min-w-0">
          <div class="text-[12.5px] font-semibold" style="color: var(--dig-text)">{{ n.title }}</div>
          <div v-if="n.body" class="text-[11.5px] mt-[2px] leading-[1.4] line-clamp-2" style="color: var(--dig-muted)">{{ n.body }}</div>
          <div class="text-[10.5px] mt-[5px]" style="color: var(--dig-faint)">{{ relativeTime(n.createdAt) }}</div>
        </div>
        <span v-if="!n.readAt" class="mt-[4px] flex-shrink-0 w-[7px] h-[7px] rounded-full" style="background: var(--dig-accent)" aria-label="unread" />
      </button>

      <!-- footer -->
      <button
        type="button"
        class="w-full px-[16px] py-[12px] text-center text-[12.5px] font-semibold cursor-pointer"
        style="color: var(--dig-accent); border-top: 1px solid var(--dig-line-soft)"
        @click="goAlerts"
      >
        View all alerts
      </button>
    </div>
  </div>
</template>
