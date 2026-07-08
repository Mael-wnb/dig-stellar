<script setup lang="ts">
// apps/web/src/components/bridge/BridgeSection.vue
// SCF T2-D3 — full bridge section (Paul DA). Header (+ scope chip) · range chips · stat strip ·
// chart · legend · tabs (Routes / Recent flows) · active table.
// Dumb container: all data via props, events out. Wire it to the house `useBridge` (see handoff).

import { ref, computed } from 'vue'
import BridgeChart from './BridgeChart.vue'
import BridgeRoutesTable from './BridgeRoutesTable.vue'
import BridgeFlowsFeed from './BridgeFlowsFeed.vue'

type Win = '24h' | '7d' | '30d'
interface Bucket { inflow: number; outflow: number; net: number; centerTs: number }

const props = defineProps<{
  window: Win
  totals: { inflowUsd: number; outflowUsd: number; netUsd: number }
  buckets: Bucket[]
  routes: any[]
  flows: any[]
  chainScope: string | null
  routeSort: { key: string; dir: 'asc' | 'desc' }
  flowSort: { key: string; dir: 'asc' | 'desc' }
  loading?: boolean
  error?: string | null
}>()
const emit = defineEmits<{
  (e: 'update:window', w: Win): void
  (e: 'scope', chain: string): void
  (e: 'clearScope'): void
  (e: 'sortRoutes', key: string): void
  (e: 'sortFlows', key: string): void
  (e: 'retry'): void
}>()

const tab = ref<'routes' | 'flows'>('routes')
const RANGES: Win[] = ['24h', '7d', '30d']

const scopeLabel = computed(() => (props.chainScope ? `${props.chainScope} → Stellar` : 'All routes → Stellar'))
const winLabel = computed(() => props.window.toUpperCase())
const flowsTitle = computed(() => (props.chainScope ? `Recent bridge flows · ${props.chainScope}` : 'Recent bridge flows'))

const fmtUsd = (v: number, signed = false) => {
  const a = Math.abs(v)
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a.toFixed(0)}`
  return signed ? (v < 0 ? '−' : '+') + s : s
}
const stats = computed(() => [
  { label: `Inflow · ${winLabel.value}`, value: fmtUsd(props.totals.inflowUsd, true), color: '#2E9E63' },
  { label: `Outflow · ${winLabel.value}`, value: '−' + fmtUsd(props.totals.outflowUsd), color: '#D0522E' },
  { label: `Net · ${winLabel.value}`, value: fmtUsd(props.totals.netUsd, true), color: props.totals.netUsd < 0 ? '#E0603E' : '#E2E6E1' },
])
</script>

<template>
  <section class="bg-[#2A2A2A] border border-[#383838] rounded-[12px] p-5">
    <!-- header -->
    <div class="flex items-start justify-between mb-5">
      <div class="flex items-center gap-[11px]">
        <span class="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center flex-shrink-0" style="background:#2E3A14; color:#D5FF2F;">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v10M8 9l4 4 4-4" /><path d="M4 21h16M4 21v-4M20 21v-4" />
          </svg>
        </span>
        <div>
          <div class="text-[15px] font-bold text-[#e2e6e1] flex items-center gap-[9px]">
            Bridge inflows to Stellar
            <button v-if="chainScope" class="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#141414] rounded-full pl-2.5 pr-1.5 py-[3px] cursor-pointer" style="background:#D5FF2F;" @click="emit('clearScope')">
              {{ scopeLabel }}
              <span class="inline-flex w-[15px] h-[15px] rounded-full items-center justify-center text-[11px]" style="background:rgba(0,0,0,.25);">×</span>
            </button>
          </div>
          <div class="text-[12px] text-[#9a9b99] mt-0.5">{{ scopeLabel }} · Allbridge attribution</div>
        </div>
      </div>
      <div class="flex gap-1.5">
        <button v-for="r in RANGES" :key="r"
                class="text-[11.5px] font-semibold px-[9px] py-1 rounded-[8px] cursor-pointer"
                :style="window === r ? 'background:#2A2A27; color:#E2E6E1;' : 'background:transparent; color:#5E5F5D;'"
                @click="emit('update:window', r)">{{ r.toUpperCase() }}</button>
      </div>
    </div>

    <!-- stat strip -->
    <div class="flex gap-9 mb-[18px] flex-wrap">
      <div v-for="s in stats" :key="s.label">
        <div class="text-[12px] text-[#9a9b99]">{{ s.label }}</div>
        <div class="text-[24px] font-bold mt-[3px] tabular-nums" style="letter-spacing:-.02em;" :style="{ color: s.color }">{{ s.value }}</div>
      </div>
    </div>

    <!-- error / chart -->
    <div v-if="error && !buckets.length" class="h-[160px] flex flex-col items-center justify-center text-center">
      <p class="text-[12px] text-[#ff7b7b]">{{ error }}</p>
      <button class="mt-2 text-[12px] text-[#d5ff2f] cursor-pointer" @click="emit('retry')">Retry</button>
    </div>
    <div v-else-if="loading && !buckets.length" class="h-[160px] rounded-[8px] bg-[#202020] animate-pulse" />
    <BridgeChart v-else :buckets="buckets" />

    <!-- chart legend -->
    <div class="flex gap-[18px] flex-wrap mt-3 mb-6 text-[12px]">
      <span class="flex items-center gap-1.5 text-[#9a9b99]"><span class="w-2.5 h-2.5 rounded-[3px]" style="background:#B8E640;" />Inflow</span>
      <span class="flex items-center gap-1.5 text-[#9a9b99]"><span class="w-2.5 h-2.5 rounded-[3px]" style="background:#4C4C46;" />Outflow</span>
      <span class="flex items-center gap-1.5 text-[#9a9b99]"><span class="w-3 h-[3px] rounded-[2px]" style="background:#E2E6E1;" />Cumulative net</span>
    </div>

    <!-- tabs -->
    <div class="flex items-center gap-2.5 mb-2.5">
      <div class="flex gap-1 p-[3px] rounded-[11px] bg-[#242422]">
        <button v-for="[k, label] in [['routes', 'Routes'], ['flows', 'Recent flows']] as const" :key="k"
                class="text-[12px] font-semibold px-3 py-1.5 rounded-[8px] cursor-pointer"
                :style="tab === k ? 'background:#D5FF2F; color:#141414;' : 'background:transparent; color:#9a9b99;'"
                @click="tab = k as 'routes' | 'flows'">{{ label }}</button>
      </div>
    </div>

    <!-- active table -->
    <BridgeRoutesTable v-if="tab === 'routes'" :routes="routes" :sort="routeSort" :active-chain="chainScope"
                       @sort="emit('sortRoutes', $event)" @scope="emit('scope', $event)" />
    <BridgeFlowsFeed v-else :flows="flows" :sort="flowSort" :title="flowsTitle" @sort="emit('sortFlows', $event)" />
  </section>
</template>