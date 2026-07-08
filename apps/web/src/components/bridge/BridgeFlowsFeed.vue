<script setup lang="ts">
// apps/web/src/components/bridge/BridgeFlowsFeed.vue
// SCF T2-D3 — recent bridge flows feed (Paul DA). Dumb: flows + sort in, `sort` out.

interface FlowRow {
  id: string; chain: string; mark: string; tint: string; color: string
  dir: 'in' | 'out'; asset: string; amountUsd: number; occurredAt: string; txHash: string
}
defineProps<{
  flows: FlowRow[]
  sort: { key: string; dir: 'asc' | 'desc' }
  title?: string
}>()
const emit = defineEmits<{ (e: 'sort', key: string): void }>()

const COLS: Array<[string, string, 'left' | 'right']> = [
  ['chain', 'Source', 'left'], ['dir', 'Direction', 'left'], ['asset', 'Asset', 'left'],
  ['amount', 'Amount', 'right'], ['time', 'Time', 'right'], ['tx', 'Tx', 'right'],
]
const fmtUsd = (v: number) => {
  const a = Math.abs(v)
  return a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(0)}K` : `$${a.toFixed(0)}`
}
const relTime = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}
const shortTx = (h: string) => (h && h.length > 10 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h)
const arrow = (key: string, sort: { key: string; dir: string }) => (sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '')
</script>

<template>
  <div>
    <p class="text-[12.5px] font-semibold text-[#5E5F5D] mb-1.5">{{ title ?? 'Recent bridge flows' }}</p>
    <!-- header -->
    <div class="grid items-center px-2 py-2.5 text-[11px] font-semibold uppercase tracking-[.04em] border-b border-[#2C2C29]"
         style="grid-template-columns:1.8fr 1fr 0.9fr 1fr 0.9fr 0.9fr;">
      <button v-for="[k, label, al] in COLS" :key="k"
              class="cursor-pointer select-none bg-transparent"
              :style="{ textAlign: al, color: sort.key === k ? '#E2E6E1' : '#5E5F5D' }"
              @click="emit('sort', k)">{{ label }}{{ arrow(k, sort) }}</button>
    </div>
    <!-- rows -->
    <div v-for="f in flows" :key="f.id"
         class="grid items-center px-2 py-[11px] border-b border-[#2C2C29]"
         style="grid-template-columns:1.8fr 1fr 0.9fr 1fr 0.9fr 0.9fr;">
      <span class="flex items-center gap-[11px]">
        <span class="w-7 h-7 rounded-[8px] flex-shrink-0 flex items-center justify-center font-bold text-[11px]"
              :style="{ background: f.tint, color: f.color }">{{ f.mark }}</span>
        <span class="flex items-center gap-1.5 text-[13px] font-semibold text-[#e2e6e1]">
          {{ f.chain }} <span class="text-[#6E6A62]">→</span> <span class="text-[#B7B3AB]">Stellar</span>
        </span>
      </span>
      <span>
        <span class="inline-flex items-center gap-1.5 text-[12px] font-semibold px-[9px] py-[3px] rounded-full"
              :style="f.dir === 'in' ? 'background:#12301F; color:#2E9E63;' : 'background:#2C2C29; color:#8A857B;'">
          {{ f.dir === 'in' ? '↓ Inflow' : '↑ Outflow' }}
        </span>
      </span>
      <span class="text-[13px] text-[#B7B3AB] tabular-nums">{{ f.asset }}</span>
      <span class="text-right text-[13.5px] font-bold tabular-nums"
            :style="{ color: f.dir === 'in' ? '#2E9E63' : '#B7B3AB' }">{{ (f.dir === 'in' ? '+' : '−') + fmtUsd(f.amountUsd) }}</span>
      <span class="text-right text-[12.5px] text-[#5E5F5D] tabular-nums">{{ relTime(f.occurredAt) }}</span>
      <span class="text-right">
        <span class="text-[11px] font-semibold text-[#5E5F5D] px-2 py-1 rounded-[7px]" style="font-family:'Geist Mono',monospace;">{{ shortTx(f.txHash) }}</span>
      </span>
    </div>
    <p v-if="!flows.length" class="text-[12.5px] text-[#5E5F5D] py-6 text-center">No flows in this window.</p>
  </div>
</template>