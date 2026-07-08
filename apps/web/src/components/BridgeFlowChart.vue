<script setup lang="ts">
// apps/web/src/components/BridgeFlowChart.vue
// SCF T2-D3 — "Inflows & outflows" chart. Reconstructed 1:1 from Paul's flowChart:
// inflow bars (up) / outflow bars (down) around a baseline + a cumulative-net line,
// with a hover tooltip. Reactive SVG (no string concat), fed by the real bridge API.
//
// NOTE (Claude Code): card chrome uses the current dashboard tokens (reconcile with the
// existing BridgeFlows.vue card). The chart's data colors (#B8E640 inflow / #4C4C46
// outflow / #E2E6E1 net) are intentional data-viz, not theme — keep them.

import { computed, onMounted, ref } from 'vue'
import { useBridgeChart, fmtUsd, type BridgeWindow } from '../composables/useBridgeChart'

const { window: win, setWindow, totals, buckets, loading, error, load } = useBridgeChart()
onMounted(load)

// ── geometry (Paul's exact values) ──────────────────────────────────────────
const W = 680, H = 160
const MID = H * 0.62
const RANGES: BridgeWindow[] = ['24h', '7d', '30d']

const n = computed(() => buckets.value.length)
const bw = computed(() => (n.value ? W / n.value : W))
const hasData = computed(() => buckets.value.some(b => b.inflow > 0 || b.outflow > 0))

const maxIn = computed(() => Math.max(1, ...buckets.value.map(b => b.inflow)))
const maxOut = computed(() => Math.max(1, ...buckets.value.map(b => b.outflow)))

const inflowBars = computed(() =>
  buckets.value.map((b, i) => {
    const h = (b.inflow / maxIn.value) * (MID - 8)
    return { x: i * bw.value + 3, y: MID - h, w: Math.max(0, bw.value - 6), h }
  }),
)
const outflowBars = computed(() =>
  buckets.value.map((b, i) => {
    const h = (b.outflow / maxOut.value) * (H - MID - 8)
    return { x: i * bw.value + 3, y: MID, w: Math.max(0, bw.value - 6), h }
  }),
)
const netPoints = computed(() => {
  const net = buckets.value.map(b => b.net)
  if (net.length < 2) return ''
  const mn = Math.min(...net), mx = Math.max(...net), rng = (mx - mn) || 1
  const step = W / (net.length - 1)
  return net.map((p, i) => `${(i * step).toFixed(1)},${(H - 12 - ((p - mn) / rng) * (H - 26)).toFixed(1)}`).join(' ')
})

// ── hover ───────────────────────────────────────────────────────────────────
const hover = ref<number | null>(null)
const tip = computed(() => {
  if (hover.value == null) return null
  const b = buckets.value[hover.value]
  if (!b) return null
  const leftPct = ((hover.value + 0.5) / n.value) * 100
  return {
    leftPct,
    flip: hover.value > n.value * 0.6,
    timeLabel: relTime(b.centerTs),
    inflow: fmtUsd(b.inflow),
    outflow: fmtUsd(b.outflow),
    net: fmtUsd(b.net, true),
  }
})

function relTime(ts: number): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
</script>

<template>
  <section class="bg-[#2A2A2A] border border-[#383838] rounded-[12px] p-4">
    <!-- header -->
    <div class="flex items-start justify-between mb-4">
      <div>
        <p class="text-[13px] font-semibold text-[#e2e6e1] font-mono">Inflows &amp; outflows</p>
        <p class="text-[11.5px] text-[#9a9b99] mt-0.5">Deposits vs withdrawals · derived from the event stream</p>
      </div>
      <div class="flex gap-1.5">
        <button
          v-for="r in RANGES"
          :key="r"
          class="text-[11px] font-mono font-bold px-2.5 py-1 rounded-[7px] cursor-pointer transition-colors"
          :style="win === r
            ? 'background:#373b26; border:1px solid #d5ff2f; color:#d5ff2f;'
            : 'background:transparent; border:1px solid transparent; color:#9a9b99;'"
          @click="setWindow(r)"
        >{{ r }}</button>
      </div>
    </div>

    <!-- stat tiles -->
    <div class="grid grid-cols-3 gap-2.5 mb-4">
      <div class="bg-[#202020] border border-[#383838] rounded-[10px] px-3.5 py-3">
        <p class="text-[11px] text-[#9a9b99]">Inflow</p>
        <p class="text-[17px] font-bold mt-1 tabular-nums" style="color:#B8E640;">{{ fmtUsd(totals.inflowUsd) }}</p>
      </div>
      <div class="bg-[#202020] border border-[#383838] rounded-[10px] px-3.5 py-3">
        <p class="text-[11px] text-[#9a9b99]">Outflow</p>
        <p class="text-[17px] font-bold mt-1 tabular-nums text-[#c8c9c4]">{{ fmtUsd(totals.outflowUsd) }}</p>
      </div>
      <div class="bg-[#202020] border border-[#383838] rounded-[10px] px-3.5 py-3">
        <p class="text-[11px] text-[#9a9b99]">Net</p>
        <p class="text-[17px] font-bold mt-1 tabular-nums"
           :style="{ color: totals.netUsd < 0 ? '#ff7b7b' : '#B8E640' }">{{ fmtUsd(totals.netUsd, true) }}</p>
      </div>
    </div>

    <!-- legend -->
    <div class="flex items-center gap-4 text-[11.5px] mb-2 flex-wrap">
      <span class="flex items-center gap-1.5 text-[#9a9b99]"><span class="w-2.5 h-2.5 rounded-[3px]" style="background:#B8E640;" />Inflow</span>
      <span class="flex items-center gap-1.5 text-[#9a9b99]"><span class="w-2.5 h-2.5 rounded-[3px]" style="background:#4C4C46;" />Outflow</span>
      <span class="flex items-center gap-1.5 text-[#9a9b99]"><span class="w-3 h-[3px] rounded-[2px]" style="background:#E2E6E1;" />Cumulative net</span>
      <span class="ml-auto text-[#9a9b99]">Net <span class="font-bold text-[#e2e6e1] tabular-nums">{{ fmtUsd(totals.netUsd, true) }}</span></span>
    </div>

    <!-- chart -->
    <div class="relative w-full" @mouseleave="hover = null">
      <!-- loading -->
      <div v-if="loading && !hasData" class="h-[160px] rounded-[8px] bg-[#202020] animate-pulse" />

      <!-- error -->
      <div v-else-if="error && !hasData" class="h-[160px] flex flex-col items-center justify-center text-center">
        <p class="text-[12px] text-[#ff7b7b]">{{ error }}</p>
        <button class="mt-2 text-[12px] text-[#d5ff2f] font-mono cursor-pointer" @click="load">Retry</button>
      </div>

      <!-- empty -->
      <div v-else-if="!hasData" class="h-[160px] flex flex-col items-center justify-center text-center">
        <p class="text-[13px] text-[#e2e6e1]">No bridge flows in this window</p>
        <p class="text-[11.5px] text-[#9a9b99] mt-1 max-w-[280px]">
          Allbridge Core inflows appear here as they land (~7-day retention).
        </p>
      </div>

      <!-- svg -->
      <template v-else>
        <svg :viewBox="`0 0 ${W} ${H}`" width="100%" :height="H" preserveAspectRatio="none" class="block leading-none">
          <line x1="0" :y1="MID" :x2="W" :y2="MID" stroke="#37372F" stroke-width="1" stroke-dasharray="4 5" />
          <rect v-for="(b, i) in inflowBars" :key="'in' + i" :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="2.5" fill="#B8E640" />
          <rect v-for="(b, i) in outflowBars" :key="'out' + i" :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="2.5" fill="#4C4C46" />
          <polyline v-if="netPoints" :points="netPoints" fill="none" stroke="#E2E6E1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>

        <!-- hover marker -->
        <div v-if="hover != null" class="absolute top-0 bottom-0 w-px bg-[#5E5F5D] pointer-events-none"
             :style="{ left: ((hover + 0.5) / n) * 100 + '%' }" />

        <!-- hover columns -->
        <div class="absolute inset-0 flex">
          <div v-for="i in n" :key="i" class="flex-1 h-full cursor-crosshair"
               :style="{ background: hover === i - 1 ? 'rgba(255,255,255,0.05)' : 'transparent' }"
               @mouseenter="hover = i - 1" />
        </div>

        <!-- tooltip -->
        <div v-if="tip" class="absolute -top-1.5 pointer-events-none z-10"
             :style="{ left: tip.leftPct + '%', transform: `translate(${tip.flip ? '-100%' : '0'}, -100%)`, marginLeft: (tip.flip ? -8 : 8) + 'px' }">
          <div class="bg-[#161615] border border-[#37372F] rounded-[11px] px-3 py-2.5 min-w-[150px]"
               style="box-shadow:0 8px 24px rgba(0,0,0,.5);">
            <p class="text-[11px] text-[#5E5F5D] font-semibold mb-0.5">{{ tip.timeLabel }}</p>
            <div class="flex items-center gap-1.5 text-[12px] mt-1">
              <span class="w-2 h-2 rounded-[2px]" style="background:#B8E640;" />
              <span class="text-[#8A857B]">Inflow</span>
              <span class="ml-auto font-bold text-[#e2e6e1] tabular-nums">{{ tip.inflow }}</span>
            </div>
            <div class="flex items-center gap-1.5 text-[12px] mt-1">
              <span class="w-2 h-2 rounded-[2px]" style="background:#4C4C46;" />
              <span class="text-[#8A857B]">Outflow</span>
              <span class="ml-auto font-bold text-[#e2e6e1] tabular-nums">{{ tip.outflow }}</span>
            </div>
            <div class="flex items-center gap-1.5 text-[12px] mt-1">
              <span class="w-2 h-2 rounded-[2px]" style="background:#E2E6E1;" />
              <span class="text-[#8A857B]">Net</span>
              <span class="ml-auto font-bold text-[#e2e6e1] tabular-nums">{{ tip.net }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>