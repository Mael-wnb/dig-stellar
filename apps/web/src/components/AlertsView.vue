<script setup lang="ts">
// AlertsView — the dedicated Alerts page. Rule management on top (list + reveal-form)
// and notification history below. History reuses useNotifications (shared module
// state with the bell) with `before`-cursor "Load more". Rule management uses
// useAlertRules. Wallets are fetched once here and passed to the form + list.

import { onMounted, ref } from 'vue'
import type { WalletItem } from '../types/wallet'
import { fetchWalletOverview } from '../api/wallets'
import { useAppUser } from '../composables/useAppUser'
import { useAlertRules } from '../composables/useAlertRules'
import { useNotifications } from '../composables/useNotifications'
import { relativeTime } from '../utils/format'
import AlertRuleForm from './AlertRuleForm.vue'
import AlertRulesList from './AlertRulesList.vue'
import DashboardHeader from './DashboardHeader.vue'

const { userId } = useAppUser()
const { load: loadRules } = useAlertRules()
const {
  notifications,
  loading: historyLoading,
  error: historyError,
  hasMore,
  load: loadHistory,
  loadMore,
  markAsRead,
} = useNotifications()

const wallets = ref<WalletItem[]>([])
const walletsError = ref<string | null>(null)
const showForm = ref(false)

async function loadWallets() {
  const id = userId.value?.trim()
  if (!id) {
    wallets.value = []
    return
  }
  walletsError.value = null
  try {
    const res = await fetchWalletOverview(id)
    wallets.value = res.wallets ?? []
  } catch (e) {
    walletsError.value = e instanceof Error ? e.message : 'Failed to load wallets'
  }
}

function onCreated() {
  showForm.value = false // the rules list reloads itself via the composable
}

function onRowClick(id: string) {
  void markAsRead(id)
}

onMounted(async () => {
  await loadWallets()
  void loadRules()
  void loadHistory()
})
</script>

<template>
  <DashboardHeader />

  <section class="flex flex-col gap-8 max-w-[720px] mx-auto px-4 py-8">
    <!-- ── Rule management ── -->
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-[16px] font-medium text-[#e2e6e1]">Alerts</h2>
        <button
          type="button"
          class="px-3 py-2 rounded-md bg-[#d5ff2f] text-[#1a1f0e] text-[13px] font-semibold hover:bg-[#c2eb20] transition-colors"
          @click="showForm = !showForm"
        >
          {{ showForm ? 'Close' : 'New alert' }}
        </button>
      </div>

      <p v-if="walletsError" class="text-[12px] text-[#FF6B6B]">{{ walletsError }}</p>

      <AlertRuleForm
        v-if="showForm"
        :wallets="wallets"
        @created="onCreated"
        @cancel="showForm = false"
      />

      <AlertRulesList :wallets="wallets" />
    </div>

    <!-- ── Notification history ── -->
    <div class="flex flex-col gap-3">
      <h3 class="text-[14px] font-medium text-[#e2e6e1]">History</h3>

      <div
        v-if="historyLoading && notifications.length === 0"
        class="text-[13px] text-[#717270] py-4"
      >
        Loading…
      </div>

      <div v-else-if="historyError" class="text-[13px] text-[#FF6B6B] py-2">
        {{ historyError }}
      </div>

      <div
        v-else-if="notifications.length === 0"
        class="text-[13px] text-[#717270] py-6"
      >
        No alerts yet
      </div>

      <ul v-else class="flex flex-col rounded-lg border border-[#383838] bg-[#1f1f1f] overflow-hidden">
        <li
          v-for="n in notifications"
          :key="n.id"
          class="flex items-start gap-3 px-4 py-3 border-b border-[#262626] last:border-b-0 cursor-pointer hover:bg-[#2A2A2A] transition-colors"
          @click="onRowClick(n.id)"
        >
          <!-- Kind icon -->
          <span class="mt-0.5 shrink-0">
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
              class="text-[13px] leading-snug"
              :class="n.readAt ? 'text-[#9a9b99]' : 'text-[#e2e6e1] font-medium'"
            >
              {{ n.title }}
            </p>
            <p v-if="n.body" class="mt-0.5 text-[12px] text-[#717270]">{{ n.body }}</p>
            <span class="mt-1 block text-[11px] text-[#5E5F5D]">
              {{ relativeTime(n.createdAt) }}
            </span>
          </div>

          <!-- Unread marker -->
          <span
            v-if="!n.readAt"
            class="mt-1.5 shrink-0 w-[7px] h-[7px] rounded-full bg-[#d5ff2f]"
            aria-label="unread"
          />
        </li>
      </ul>

      <button
        v-if="hasMore && notifications.length > 0"
        type="button"
        :disabled="historyLoading"
        class="self-center px-4 py-2 rounded-md border border-[#383838] text-[12px] text-[#9a9b99] hover:text-[#e2e6e1] hover:border-[#4b4c4b] disabled:opacity-50 transition-colors"
        @click="loadMore"
      >
        {{ historyLoading ? 'Loading…' : 'Load more' }}
      </button>
    </div>
  </section>
</template>
