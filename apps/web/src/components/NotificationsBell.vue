<script setup lang="ts">
// NotificationsBell — D2 alerting bell (badge + dropdown). All data logic lives in
// useNotifications (shared with the future Alerts page); this is presentation only.
// Styling uses inline Tailwind utilities with the dashboard palette (see
// BridgeFlows.vue), and inline SVG glyphs (no icon dependency).

import { computed, ref } from 'vue'
import { useNotifications } from '../composables/useNotifications'
import { relativeTime } from '../utils/format'

const { notifications, unreadCount, loading, error, load, markAsRead, markAllAsRead } =
  useNotifications()

const open = ref(false)

const badgeText = computed(() => (unreadCount.value > 9 ? '9+' : String(unreadCount.value)))
const hasUnread = computed(() => unreadCount.value > 0)
// Dropdown shows the latest few; full history is the (later) Alerts page.
const visible = computed(() => notifications.value.slice(0, 8))

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
</script>

<template>
  <div class="relative">
    <!-- Bell button + unread badge -->
    <button
      type="button"
      aria-label="Notifications"
      class="relative flex items-center justify-center w-9 h-9 rounded-[10px] text-[#C9CDC7] hover:text-[#E2E6E1] hover:bg-[#2A2A2A] transition-colors"
      @click="toggle"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-5 h-5"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>

      <span
        v-if="hasUnread"
        class="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-[3px] flex items-center justify-center rounded-full bg-[#FF6B6B] text-[#1f1f1f] text-[10px] font-semibold leading-none"
      >
        {{ badgeText }}
      </span>
    </button>

    <!-- Click-away backdrop -->
    <div v-if="open" class="fixed inset-0 z-40" @click="close" />

    <!-- Dropdown -->
    <div
      v-if="open"
      class="absolute right-0 mt-2 w-[340px] max-h-[440px] flex flex-col rounded-[12px] border border-[#383838] bg-[#1f1f1f] shadow-xl z-50 overflow-hidden"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-[#303030]">
        <span class="text-[14px] font-medium text-[#E2E6E1]">Alerts</span>
        <button
          v-if="hasUnread"
          type="button"
          class="text-[12px] text-[#D5FF2F] hover:opacity-80 transition-opacity"
          @click="markAllAsRead"
        >
          Mark all read
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto">
        <!-- Loading -->
        <div v-if="loading" class="px-4 py-6 text-center text-[13px] text-[#717270]">
          Loading…
        </div>

        <!-- Error -->
        <div v-else-if="error" class="px-4 py-6 text-center text-[13px] text-[#FF6B6B]">
          {{ error }}
        </div>

        <!-- Empty -->
        <div
          v-else-if="visible.length === 0"
          class="px-4 py-8 text-center text-[13px] text-[#717270]"
        >
          No alerts yet
        </div>

        <!-- List -->
        <ul v-else>
          <li
            v-for="n in visible"
            :key="n.id"
            class="flex items-start gap-3 px-4 py-3 border-b border-[#262626] last:border-b-0 cursor-pointer hover:bg-[#2A2A2A] transition-colors"
            @click="onRowClick(n.id)"
          >
            <!-- Kind icon -->
            <span class="mt-0.5 shrink-0">
              <!-- alert_fired -> warning -->
              <svg
                v-if="n.kind === 'alert_fired'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#FF6B6B"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="w-4 h-4"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <!-- alert_resolved -> check -->
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="#D5FF2F"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="w-4 h-4"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </span>

            <!-- Text -->
            <div class="min-w-0 flex-1">
              <p
                class="text-[13px] leading-snug truncate"
                :class="n.readAt ? 'text-[#9a9b99]' : 'text-[#E2E6E1] font-medium'"
              >
                {{ n.title }}
              </p>
              <p v-if="n.body" class="mt-0.5 text-[12px] text-[#717270] line-clamp-2">
                {{ n.body }}
              </p>
              <span class="mt-1 block text-[11px] text-[#5E5F5D]">
                {{ relativeTime(n.createdAt) }}
              </span>
            </div>

            <!-- Unread marker -->
            <span
              v-if="!n.readAt"
              class="mt-1.5 shrink-0 w-[7px] h-[7px] rounded-full bg-[#D5FF2F]"
              aria-label="unread"
            />
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
