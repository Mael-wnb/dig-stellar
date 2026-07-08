<script setup lang="ts">
// apps/web/src/components/WalletAlertsPanel.vue
// Compact Alerts panel for the multi-wallet dashboard right column (SCF T2-D2).
// Replaces the "On-chain actions — Coming soon" placeholder. Reuses the SAME shared
// data + modal as the full Alerts page and the header bell (single source of truth).
//
// NOTE (Claude Code): the hex values here approximate the CURRENT dashboard style from
// the screenshot. Reconcile card / chip / button classes + accent token with the panel
// you are replacing so this drops in natively. Do NOT restyle to Paul's IBM-Plex system.

import { onMounted, computed, ref } from 'vue'
import AlertRuleModal from './AlertRuleModal.vue'
import {
  useAlerts, SEVERITY_STYLE, metricIconKey, timeAgo,
  type CreateRulePayload,
} from '../composables/useAlerts'

const emit = defineEmits<{ (e: 'view-all'): void }>()

const { feed, wallets, loading, error, load, createRule } = useAlerts()
const modalOpen = ref(false)

// If the Alerts page can be mounted at the same time, dedupe the load in the composable
// instead. On the dashboard screen this panel is the only consumer, so a plain load is fine.
onMounted(load)

const recent = computed(() => feed.value.slice(0, 6))

async function onCreate(payload: CreateRulePayload) {
  await createRule(payload)
  modalOpen.value = false
}

const ICONS: Record<string, string[]> = {
  heart: ['M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z'],
  trend: ['M3 17l6-6 4 4 8-8', 'M17 7h4v4'],
  drop: ['M12 2s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z'],
  wallet: ['M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11', 'M16 13h.01'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
}
const iconFor = (n: { metric?: any; category?: string }) => ICONS[metricIconKey(n)] ?? ICONS.bell
</script>

<template>
  <!-- Native dashboard card (matches the wallet / DeFi panels: #2A2A2A / #383838 / rounded-[12px]) -->
  <section class="flex flex-col h-full bg-[#2A2A2A] border border-[#383838] rounded-[12px] p-4">
    <!-- header -->
    <header class="flex items-center justify-between mb-3">
      <p class="text-[12px] text-[#9a9b99] font-mono">Alerts</p>
      <button
        class="text-[12px] font-bold text-[#d5ff2f] hover:brightness-110 cursor-pointer font-mono"
        @click="emit('view-all')"
      >View all ›</button>
    </header>

    <!-- loading -->
    <div v-if="loading && !feed.length" class="flex flex-col gap-2">
      <div v-for="i in 3" :key="i" class="h-12 rounded-[8px] bg-[#202020] animate-pulse" />
    </div>

    <!-- error -->
    <div v-else-if="error && !feed.length" class="py-8 text-center">
      <p class="text-[12px] text-[#ff7b7b]">{{ error }}</p>
      <button class="mt-2 text-[12px] text-[#d5ff2f] cursor-pointer font-mono" @click="load">Retry</button>
    </div>

    <!-- empty -->
    <div v-else-if="!recent.length" class="flex-1 flex flex-col items-center justify-center text-center py-10">
      <span class="w-9 h-9 rounded-[8px] bg-[#202020] border border-[#383838] flex items-center justify-center text-[#9a9b99] mb-3">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path v-for="d in ICONS.bell" :key="d" :d="d" />
        </svg>
      </span>
      <p class="text-[13px] text-[#e2e6e1]">No alerts yet</p>
      <p class="text-[12px] text-[#9a9b99] mt-1 max-w-[240px]">
        Create a rule and notifications will show up here.
      </p>
    </div>

    <!-- feed -->
    <div v-else class="flex-1 flex flex-col gap-1.5 overflow-y-auto">
      <article
        v-for="a in recent"
        :key="a.id"
        class="flex gap-3 px-3 py-2.5 rounded-[8px] border"
        :style="{
          background: !a.acknowledged_at ? '#202020' : 'transparent',
          borderColor: !a.acknowledged_at ? '#383838' : 'transparent',
        }"
      >
        <span
          class="w-8 h-8 flex-shrink-0 rounded-[8px] flex items-center justify-center"
          :style="{ background: SEVERITY_STYLE[a.severity].tint, color: SEVERITY_STYLE[a.severity].color }"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path v-for="d in iconFor(a)" :key="d" :d="d" />
          </svg>
        </span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-[13px] font-semibold text-[#e2e6e1] truncate">{{ a.title }}</span>
            <span v-if="!a.acknowledged_at" class="w-[6px] h-[6px] rounded-full bg-[#d5ff2f] flex-shrink-0" />
          </div>
          <p class="text-[11.5px] text-[#9a9b99] mt-0.5 truncate">
            <template v-if="a.scope_ref">{{ a.scope_ref }} · </template>{{ timeAgo(a.created_at) }}
          </p>
        </div>
      </article>
    </div>

    <!-- create (accent button, matches the dashboard "Rebalance" style) -->
    <button
      class="mt-4 h-10 rounded-[8px] bg-[#373b26] border border-[#d5ff2f] text-[#d5ff2f] font-mono font-bold text-[12px] cursor-pointer hover:bg-[rgba(213,255,47,0.12)]"
      @click="modalOpen = true"
    >+ New alert rule</button>

    <AlertRuleModal
      v-if="modalOpen"
      :wallets="wallets"
      @close="modalOpen = false"
      @create="onCreate"
    />
  </section>
</template>