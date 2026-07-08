<script setup lang="ts">
// apps/web/src/components/AlertsView.vue
// SCF T2-D2 — Alerts screen. Reconstructed 1:1 from Paul's Claude Design mock.
// Two-column layout: Activity feed (left) + Your alert rules (right).
// Topbar copy for the shell: "Alerts / Catch every move before it moves the market".

import { onMounted, onUnmounted, computed, ref } from 'vue'
import AlertRuleModal from './AlertRuleModal.vue'
import DashboardHeader from './DashboardHeader.vue'
import {
  useAlerts, SEVERITY_STYLE, metricIconKey, conditionLabel, timeAgo,
  type CreateRulePayload,
} from '../composables/useAlerts'

const { rules, feed, wallets, loading, error, load, createRule, toggleRule } = useAlerts()

const filter = ref<'all' | 'critical' | 'activity'>('all')
const modalOpen = ref(false)

const FILTERS: Array<['all' | 'critical' | 'activity', string]> = [
  ['all', 'All'], ['critical', 'Critical'], ['activity', 'Activity'],
]

const filteredFeed = computed(() =>
  feed.value.filter(a => filter.value === 'all' || (a.category ?? 'activity') === filter.value),
)
const activeCount = computed(() => rules.value.filter(r => r.enabled).length)

// HTTP polling, mirroring the existing bell / Alerts page behaviour.
let timer: number | undefined
onMounted(() => { load(); timer = window.setInterval(load, 30_000) })
onUnmounted(() => { if (timer) clearInterval(timer) })

async function onCreate(payload: CreateRulePayload) {
  await createRule(payload)
  modalOpen.value = false
}

// Line icons (stroke), matching Paul's iconography.
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
  <div class="min-h-screen bg-bg text-text">
    <!-- shell header (nav + notifications bell + wallet) -->
    <DashboardHeader />

    <div class="max-w-[1100px] mx-auto px-3 sm:px-6 py-6 sm:py-8 text-[#E2E6E1]"
         style="animation: digFade .35s ease both;">
      <!-- topbar copy: "Alerts / Catch every move before it moves the market" -->
      <div class="flex items-baseline gap-3 mb-6">
        <h1 class="text-lg font-semibold">Alerts</h1>
        <span class="text-[13px] text-[#5E5F5D]">Catch every move before it moves the market</span>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4 items-start">

      <!-- ── LEFT: Activity feed ─────────────────────────────────────────── -->
      <section class="bg-[#1E1E1E] border border-[#2F2F2C] rounded-[18px] overflow-hidden">
        <header class="flex items-center px-5 py-4 border-b border-[#2C2C29]">
          <h2 class="text-sm font-semibold">Activity feed</h2>
          <div class="flex gap-1.5 ml-3.5">
            <button
              v-for="[key, label] in FILTERS"
              :key="key"
              class="text-xs font-semibold px-[11px] py-1 rounded-lg cursor-pointer transition-colors"
              :style="filter === key
                ? 'background:#D5FF2F; color:#141414;'
                : 'background:transparent; color:#5E5F5D;'"
              @click="filter = key"
            >{{ label }}</button>
          </div>
          <button
            class="ml-auto h-[34px] px-3.5 rounded-[10px] bg-[#D5FF2F] text-[#252525] font-bold text-[12.5px] cursor-pointer hover:brightness-105"
            @click="modalOpen = true"
          >+ New rule</button>
        </header>

        <!-- loading -->
        <div v-if="loading && !feed.length">
          <div v-for="i in 4" :key="i" class="flex gap-3 px-5 py-[15px] border-b border-[#2C2C29]">
            <div class="w-9 h-9 rounded-[10px] bg-[#242422] animate-pulse" />
            <div class="flex-1 space-y-2 pt-1">
              <div class="h-3.5 w-2/5 rounded bg-[#242422] animate-pulse" />
              <div class="h-3 w-4/5 rounded bg-[#242422] animate-pulse" />
            </div>
          </div>
        </div>

        <!-- error -->
        <div v-else-if="error && !feed.length" class="px-5 py-10 text-center">
          <p class="text-[13px] text-[#D0522E]">{{ error }}</p>
          <button class="mt-3 text-[13px] text-[#D5FF2F] cursor-pointer" @click="load">Retry</button>
        </div>

        <!-- empty -->
        <div v-else-if="!filteredFeed.length" class="px-5 py-12 text-center">
          <p class="text-sm text-[#E2E6E1]">No alerts yet</p>
          <p class="text-[13px] text-[#5E5F5D] mt-1">Create a rule and notifications will show up here.</p>
        </div>

        <!-- feed -->
        <article
          v-for="a in filteredFeed"
          :key="a.id"
          class="flex gap-[13px] px-5 py-[15px] border-b border-[#2C2C29]"
          :style="{ background: !a.acknowledged_at ? '#242422' : '#1E1E1E' }"
        >
          <span
            class="w-9 h-9 flex-shrink-0 rounded-[10px] flex items-center justify-center"
            :style="{ background: SEVERITY_STYLE[a.severity].tint, color: SEVERITY_STYLE[a.severity].color }"
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path v-for="d in iconFor(a)" :key="d" :d="d" />
            </svg>
          </span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-semibold text-[#E2E6E1]">{{ a.title }}</span>
              <span
                class="text-[10.5px] font-semibold uppercase tracking-[.04em] px-[7px] py-px rounded-full"
                :style="{ background: SEVERITY_STYLE[a.severity].tint, color: SEVERITY_STYLE[a.severity].color }"
              >{{ a.severity }}</span>
              <span v-if="!a.acknowledged_at" class="w-[7px] h-[7px] rounded-full bg-[#D5FF2F]" />
            </div>
            <p class="text-[13px] text-[#5E5F5D] mt-[3px] leading-[1.45]">{{ a.body }}</p>
            <p class="text-xs text-[#5E5F5D] mt-1.5">
              <template v-if="a.scope_ref">{{ a.scope_ref }} · </template>{{ timeAgo(a.created_at) }}
            </p>
          </div>
          <!-- Optional inline action (present only if the notification carries one) -->
          <button
            v-if="(a as any).action_label"
            class="self-center h-[34px] px-3.5 rounded-[10px] bg-[#D5FF2F] text-[#141414] font-semibold text-[12.5px] cursor-pointer whitespace-nowrap hover:brightness-105"
          >{{ (a as any).action_label }}</button>
        </article>
      </section>

      <!-- ── RIGHT: Your alert rules ─────────────────────────────────────── -->
      <section class="bg-[#1E1E1E] border border-[#2F2F2C] rounded-[18px] px-[22px] py-5">
        <div class="flex items-center justify-between mb-1.5">
          <h2 class="text-sm font-semibold">Your alert rules</h2>
          <span class="text-xs text-[#5E5F5D]">{{ activeCount }} active</span>
        </div>

        <div v-if="loading && !rules.length" class="space-y-3 py-2">
          <div v-for="i in 3" :key="i" class="h-4 rounded bg-[#242422] animate-pulse" />
        </div>

        <p v-else-if="!rules.length" class="text-[13px] text-[#5E5F5D] py-6">
          No rules yet. Create your first one below.
        </p>

        <div
          v-for="r in rules"
          :key="r.id"
          class="py-3.5 border-b border-[#2C2C29]"
        >
          <div class="flex items-center gap-[9px]">
            <span class="w-2 h-2 rounded-full" :style="{ background: SEVERITY_STYLE[r.severity].dot }" />
            <span class="text-[13.5px] font-semibold">{{ r.name }}</span>
            <button
              class="ml-auto w-9 h-5 rounded-full relative cursor-pointer transition-colors"
              :style="{ background: r.enabled ? '#D5FF2F' : '#34342E' }"
              :aria-pressed="r.enabled"
              @click="toggleRule(r)"
            >
              <span
                class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-[left]"
                style="box-shadow:0 1px 3px rgba(0,0,0,.2);"
                :style="{ left: r.enabled ? '18px' : '2px' }"
              />
            </button>
          </div>
          <p class="text-xs text-[#5E5F5D] mt-[5px] ml-[17px]" style="font-family:'Geist Mono',monospace;">
            {{ conditionLabel(r) }}
          </p>
        </div>

        <button
          class="w-full mt-3.5 h-10 rounded-[11px] bg-[#262624] border border-[#2F2F2C] text-[#5E5F5D] font-semibold text-[13px] cursor-pointer hover:bg-[#2A2A27]"
          @click="modalOpen = true"
        >+ Create rule</button>
      </section>
      </div>

      <AlertRuleModal
        v-if="modalOpen"
        :wallets="wallets"
        @close="modalOpen = false"
        @create="onCreate"
      />
    </div>
  </div>
</template>