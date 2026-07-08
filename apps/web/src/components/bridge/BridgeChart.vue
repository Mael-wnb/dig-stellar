<script setup lang="ts">
// apps/web/src/components/bridge/BridgeChart.vue
// SCF T2-D3 — bare inflow/outflow + cumulative-net chart (Paul's flowChart), reactive SVG.
// Dumb: takes `buckets` and renders. Range chips / stats / legend live in BridgeSection.

import { computed, ref } from 'vue'

interface BridgeBucket { inflow: number; outflow: number; net: number; centerTs: number }
const props = defineProps<{ buckets: BridgeBucket[] }>()

const W = 680, H = 160, MID = H * 0.62
const n = computed(() => props.buckets.length)
const bw = computed(() => (n.value ? W / n.value : W))
const hasData = computed(() => props.buckets.some(b => b.inflow > 0 || b.outflow > 0))
const maxIn = computed(() => Math.max(1, ...props.buckets.map(b => b.inflow)))
const maxOut = computed(() => Math.max(1, ...props.buckets.map(b => b.outflow)))

const inflowBars = computed(() => props.buckets.map((b, i) => {
  const h = (b.inflow / maxIn.value) * (MID - 8)
  return { x: i * bw.value + 3, y: MID - h, w: Math.max(0, bw.value - 6), h }
}))
const outflowBars = computed(() => props.buckets.map((b, i) => {
  const h = (b.outflow / maxOut.value) * (H - MID - 8)
  return { x: i * bw.value + 3, y: MID, w: Math.max(0, bw.value - 6), h }
}))
const netPoints = computed(() => {
  const net = props.buckets.map(b => b.net)
  if (net.length < 2) return ''
  const mn = Math.min(...net), mx = Math.max(...net), rng = (mx - mn) || 1
  const step = W / (net.length - 1)
  return net.map((p, i) => `${(i * step).toFixed(1)},${(H - 12 - ((p - mn) / rng) * (H - 26)).toFixed(1)}`).join(' ')
})

const hover = ref<number | null>(null)
const fmtUsd = (v: number, signed = false) => {
  const a = Math.abs(v)
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a.toFixed(0)}`
  return signed ? (v < 0 ? '−' : '+') + s : s
}
const relTime = (ts: number) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}
const tip = computed(() => {
  if (hover.value == null) return null
  const b = props.buckets[hover.value]
  if (!b) return null
  return {
    leftPct: ((hover.value + 0.5) / n.value) * 100,
    flip: hover.value > n.value * 0.6,
    timeLabel: relTime(b.centerTs),
    inflow: fmtUsd(b.inflow), outflow: fmtUsd(b.outflow), net: fmtUsd(b.net, true),
  }
})
</script>

<template>
  <div class="relative w-full" @mouseleave="hover = null">
    <div v-if="!hasData" class="h-[160px] flex flex-col items-center justify-center text-center">
      <p class="text-[13px] text-[#e2e6e1]">No bridge flows in this window</p>
      <p class="text-[11.5px] text-[#9a9b99] mt-1 max-w-[300px]">
        Allbridge Core inflows appear here as they land (~7-day retention).
      </p>
    </div>
    <template v-else>
      <svg :viewBox="`0 0 ${W} ${H}`" width="100%" :height="H" preserveAspectRatio="none" class="block leading-none">
        <line x1="0" :y1="MID" :x2="W" :y2="MID" stroke="#37372F" stroke-width="1" stroke-dasharray="4 5" />
        <rect v-for="(b, i) in inflowBars" :key="'in' + i" :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="2.5" fill="#B8E640" />
        <rect v-for="(b, i) in outflowBars" :key="'out' + i" :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="2.5" fill="#4C4C46" />
        <polyline v-if="netPoints" :points="netPoints" fill="none" stroke="#E2E6E1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div v-if="hover != null" class="absolute top-0 bottom-0 w-px bg-[#5E5F5D] pointer-events-none" :style="{ left: ((hover + 0.5) / n) * 100 + '%' }" />
      <div class="absolute inset-0 flex">
        <div v-for="i in n" :key="i" class="flex-1 h-full cursor-crosshair"
             :style="{ background: hover === i - 1 ? 'rgba(255,255,255,0.05)' : 'transparent' }"
             @mouseenter="hover = i - 1" />
      </div>
      <div v-if="tip" class="absolute -top-1.5 pointer-events-none z-10"
           :style="{ left: tip.leftPct + '%', transform: `translate(${tip.flip ? '-100%' : '0'}, -100%)`, marginLeft: (tip.flip ? -8 : 8) + 'px' }">
        <div class="bg-[#161615] border border-[#37372F] rounded-[11px] px-3 py-2.5 min-w-[150px]" style="box-shadow:0 8px 24px rgba(0,0,0,.5);">
          <p class="text-[11px] text-[#5E5F5D] font-semibold mb-0.5">{{ tip.timeLabel }}</p>
          <div class="flex items-center gap-1.5 text-[12px] mt-1"><span class="w-2 h-2 rounded-[2px]" style="background:#B8E640;" /><span class="text-[#8A857B]">Inflow</span><span class="ml-auto font-bold text-[#e2e6e1] tabular-nums">{{ tip.inflow }}</span></div>
          <div class="flex items-center gap-1.5 text-[12px] mt-1"><span class="w-2 h-2 rounded-[2px]" style="background:#4C4C46;" /><span class="text-[#8A857B]">Outflow</span><span class="ml-auto font-bold text-[#e2e6e1] tabular-nums">{{ tip.outflow }}</span></div>
          <div class="flex items-center gap-1.5 text-[12px] mt-1"><span class="w-2 h-2 rounded-[2px]" style="background:#E2E6E1;" /><span class="text-[#8A857B]">Net</span><span class="ml-auto font-bold text-[#e2e6e1] tabular-nums">{{ tip.net }}</span></div>
        </div>
      </div>
    </template>
  </div>
</template>