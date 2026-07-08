<script setup lang="ts">
// apps/web/src/components/bridge/BridgeRoutesTable.vue
// SCF T2-D3 — per-chain routes table (Paul DA). Clicking a row scopes the whole section to
// that chain; headers sort. Dumb: data + sort state in, `sort`/`scope` events out.

interface RouteRow {
  chain: string; mark: string; tint: string; color: string
  inflowUsd: number; outflowUsd: number; netUsd: number; share: number // share 0–100
}
defineProps<{
  routes: RouteRow[]
  sort: { key: string; dir: 'asc' | 'desc' }
  activeChain: string | null
}>()
const emit = defineEmits<{ (e: 'sort', key: string): void; (e: 'scope', chain: string): void }>()

const COLS: Array<[string, string, 'left' | 'right']> = [
  ['chain', 'Route', 'left'], ['inflow', 'Inflow', 'right'],
  ['outflow', 'Outflow', 'right'], ['net', 'Net', 'right'], ['share', 'Share', 'right'],
]
const fmtUsd = (v: number, signed = false) => {
  const a = Math.abs(v)
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a.toFixed(0)}`
  return signed ? (v < 0 ? '−' : '+') + s : s
}
const arrow = (key: string, sort: { key: string; dir: string }) => (sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '')
</script>

<template>
  <div>
    <p class="text-[11.5px] text-[#5E5F5D] mb-1.5">Click a route to inspect its recent flows</p>
    <!-- header -->
    <div class="grid items-center px-2 py-2.5 text-[11px] font-semibold uppercase tracking-[.04em] border-b border-[#2C2C29]"
         style="grid-template-columns:2.2fr 1fr 1fr 1fr 0.8fr 0.9fr;">
      <button v-for="[k, label, al] in COLS" :key="k"
              class="cursor-pointer select-none bg-transparent"
              :style="{ textAlign: al, color: sort.key === k ? '#E2E6E1' : '#5E5F5D' }"
              @click="emit('sort', k)">{{ label }}{{ arrow(k, sort) }}</button>
      <span class="text-right text-[#5E5F5D]">Flow</span>
    </div>
    <!-- rows -->
    <button v-for="r in routes" :key="r.chain"
            class="grid items-center w-full text-left px-2 py-3 border-b border-[#2C2C29] cursor-pointer rounded-[10px] transition-colors"
            style="grid-template-columns:2.2fr 1fr 1fr 1fr 0.8fr 0.9fr;"
            :style="activeChain === r.chain ? 'background:#242422; box-shadow:inset 2px 0 0 #D5FF2F;' : 'background:transparent;'"
            @click="emit('scope', r.chain)">
      <span class="flex items-center gap-[11px]">
        <span class="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center font-bold text-[12px] flex-shrink-0"
              :style="{ background: r.tint, color: r.color }">{{ r.mark }}</span>
        <span class="flex items-center gap-1.5 text-[13.5px] font-semibold text-[#e2e6e1]">
          {{ r.chain }} <span class="text-[#6E6A62]">→</span> <span class="text-[#B7B3AB]">Stellar</span>
        </span>
      </span>
      <span class="text-right text-[13.5px] font-semibold tabular-nums" style="color:#2E9E63;">{{ fmtUsd(r.inflowUsd) }}</span>
      <span class="text-right text-[13.5px] text-[#5E5F5D] tabular-nums">{{ fmtUsd(r.outflowUsd) }}</span>
      <span class="text-right text-[13.5px] font-bold tabular-nums" :style="{ color: r.netUsd < 0 ? '#E0603E' : '#E2E6E1' }">{{ fmtUsd(r.netUsd, true) }}</span>
      <span class="text-right text-[13px] text-[#5E5F5D] tabular-nums">{{ r.share.toFixed(0) }}%</span>
      <span class="text-right">
        <span class="inline-flex items-center gap-[5px] text-[12px] font-semibold"
              :style="{ color: r.netUsd < 0 ? '#E0603E' : '#2E9E63' }">
          {{ r.netUsd < 0 ? 'Net outflow' : 'Net inflow' }}
        </span>
      </span>
    </button>
  </div>
</template>