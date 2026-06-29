<script setup lang="ts">
import { computed, ref } from 'vue'
import { useBridgeSeries } from '../composables/useBridgeSeries'
import { formatUsd } from '../utils/format'
import type { BridgeSeriesPoint } from '../api/bridge'

const { series, loading, error } = useBridgeSeries()

// Symmetric scale: every bar is normalised against the largest-magnitude net
// day, so the biggest day fills a half-height and the rest stay proportional.
const maxAbs = computed(() =>
  series.value.reduce((m, p) => Math.max(m, Math.abs(p.netUsd)), 0)
)

// "Empty" = no flows at all over the window (gap-filled zeros). A day where
// inflow == outflow (net 0 but real flows) is NOT empty — it just sits flat.
const isEmpty = computed(
  () =>
    series.value.length > 0 &&
    series.value.every((p) => p.inflowUsd === 0 && p.outflowUsd === 0)
)

// Bar height as a % of its half. Min 6% for any non-zero day so a tiny day is
// still visible; a true 0 day returns 0 and sits on the zero line.
function barPct(net: number): number {
  if (net === 0 || maxAbs.value === 0) return 0
  return Math.max(6, Math.round((Math.abs(net) / maxAbs.value) * 100))
}
function upHeight(p: BridgeSeriesPoint): string {
  return p.netUsd > 0 ? `${barPct(p.netUsd)}%` : '0%'
}
function downHeight(p: BridgeSeriesPoint): string {
  return p.netUsd < 0 ? `${barPct(p.netUsd)}%` : '0%'
}

// Hover state drives the tooltip + dims the other bars.
const hovered = ref<number | null>(null)
function barOpacity(i: number): number {
  if (hovered.value === null) return 0.85
  return hovered.value === i ? 1 : 0.35
}

// 'YYYY-MM-DD' (UTC) -> 'Jun 28'. Parse as UTC so the label matches the bucket.
function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

const firstLabel = computed(() =>
  series.value.length ? formatDay(series.value[0].day) : ''
)
const lastLabel = computed(() =>
  series.value.length ? formatDay(series.value[series.value.length - 1].day) : ''
)

const hoveredPoint = computed<BridgeSeriesPoint | null>(() =>
  hovered.value !== null ? series.value[hovered.value] ?? null : null
)

// Anchor the tooltip over the hovered column. Clamp horizontally so edge bars
// don't push it outside the card (which clips via overflow-hidden).
const tooltipStyle = computed(() => {
  if (hovered.value === null || !series.value.length) return {}
  const raw = ((hovered.value + 0.5) / series.value.length) * 100
  const left = Math.min(82, Math.max(18, raw))
  return { left: `${left}%`, top: '6px', transform: 'translateX(-50%)' }
})

function signedUsd(n: number): string {
  return `${n >= 0 ? '+' : ''}${formatUsd(n)}`
}
</script>

<template>
  <section class="flex flex-col gap-6">

    <!-- SECTION HEADER -->
    <div class="flex items-center gap-2">
      <span class="text-base text-[#D5FF2F] font-normal whitespace-nowrap" style="font-family: 'IBM Plex Sans', sans-serif">
        Outflow / Inflow
      </span>
      <div class="flex-1 h-px bg-[#7D922A]" />
      <span class="text-sm text-[#838583] font-light whitespace-nowrap" style="font-family: 'IBM Plex Sans', sans-serif">
        Net capital flow · 7D
      </span>
    </div>

    <!-- CARD -->
    <div class="bg-[#2A2A2A] border border-[#383838] rounded-xl flex flex-col relative overflow-hidden" style="height: 226px">

      <!-- CARD HEADER -->
      <div class="flex items-center justify-between px-4 py-4 border-b border-[#383838]">
        <span class="text-[13px] font-semibold text-white">Stellar Net Flow (USD)</span>
        <div class="flex items-center gap-2">
          <span class="text-xs font-light text-[#D5FF2F]">▲ Inflow</span>
          <span class="text-xs font-light text-[#FF6B6B]">▼ Outflow</span>
        </div>
      </div>

      <!-- ERROR -->
      <div
        v-if="error"
        class="flex-1 flex items-center justify-center px-4 text-center text-[13px] text-red-400"
      >
        {{ error }}
      </div>

      <!-- LOADING SKELETON -->
      <div
        v-else-if="loading && !series.length"
        class="flex-1 flex flex-col px-2.5 pb-2.5 min-h-0"
      >
        <div class="flex gap-1 flex-1 min-h-0 items-center">
          <div v-for="i in 7" :key="i" class="flex-1 flex flex-col justify-center gap-1">
            <div class="w-full h-6 bg-[#303030] rounded-sm skeleton-pulse" />
            <div class="w-full h-4 bg-[#262626] rounded-sm skeleton-pulse" />
          </div>
        </div>
        <div class="h-px bg-[#383838] mt-1" />
        <div class="flex items-center justify-between mt-1.5">
          <div class="w-10 h-3 bg-[#303030] rounded skeleton-pulse" />
          <div class="w-10 h-3 bg-[#303030] rounded skeleton-pulse" />
        </div>
      </div>

      <!-- EMPTY (no flows in window) -->
      <div
        v-else-if="isEmpty"
        class="flex-1 flex items-center justify-center px-4 text-center text-[13px] text-[#5E5F5D]"
      >
        No bridge flows in the last 7 days.
      </div>

      <!-- CHART BODY -->
      <div v-else class="flex-1 flex flex-col px-2.5 pb-2.5 min-h-0 relative">

        <!-- HOVER TOOLTIP (absolute pill, house style — no charting lib) -->
        <div
          v-if="hoveredPoint"
          class="absolute z-10 pointer-events-none flex flex-col gap-0.5 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg px-3 py-2 shadow-lg whitespace-nowrap"
          :style="tooltipStyle"
        >
          <span class="text-[11px] text-[#9a9b99]">{{ formatDay(hoveredPoint.day) }}</span>
          <span
            class="text-[13px] font-semibold"
            :class="hoveredPoint.netUsd >= 0 ? 'text-[#D5FF2F]' : 'text-[#FF6B6B]'"
          >
            {{ signedUsd(hoveredPoint.netUsd) }}
          </span>
          <span class="text-[10px] text-[#717270]">
            In {{ formatUsd(hoveredPoint.inflowUsd) }} · Out {{ formatUsd(hoveredPoint.outflowUsd) }}
          </span>
        </div>

        <!-- HISTOGRAM (zero baseline in the middle) -->
        <div class="flex gap-1 flex-1 min-h-0 relative">
          <!-- zero line -->
          <div class="absolute inset-x-0 top-1/2 h-px bg-[#383838] pointer-events-none" />

          <div
            v-for="(p, i) in series"
            :key="p.day"
            class="flex-1 flex flex-col cursor-default"
            @mouseenter="hovered = i"
            @mouseleave="hovered = null"
          >
            <!-- POSITIVE half (net > 0 grows up from center) -->
            <div class="flex-1 flex items-end">
              <div
                class="w-full rounded-t-sm transition-opacity"
                :style="{
                  height: upHeight(p),
                  background: '#D5FF2F',
                  opacity: barOpacity(i),
                }"
              />
            </div>
            <!-- NEGATIVE half (net < 0 grows down from center) -->
            <div class="flex-1 flex items-start">
              <div
                class="w-full rounded-b-sm transition-opacity"
                :style="{
                  height: downHeight(p),
                  background: '#FF6B6B',
                  opacity: barOpacity(i),
                }"
              />
            </div>
          </div>
        </div>

        <!-- DATES: first & last only, to stay uncluttered -->
        <div class="flex items-center justify-between mt-1.5">
          <span class="text-xs text-[#717270]">{{ firstLabel }}</span>
          <span class="text-xs text-[#717270]">{{ lastLabel }}</span>
        </div>
      </div>

    </div>
  </section>
</template>
