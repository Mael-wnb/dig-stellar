<script setup lang="ts">
// NetworkTvlChart — G4 (Lot G / T3-D3). The hero's network-TVL 7-day curve, drawn
// from GET /v1/network/tvl-series (G0 snapshots). Same reactive-SVG + hover-tooltip
// pattern as BridgeChart. Honest by construction:
//   • x is real time across the 7d window, so a missing hour shows as a gap;
//   • the line BREAKS across gaps > ~1 bucket — never interpolated/smoothed;
//   • while history is younger than 7d, an honest "building history since <date>"
//     note sits under the chart (meta.partial from the API).
import { computed, ref } from 'vue'
import { formatUsd } from '../utils/format'

interface TvlPoint { t: string; tvlUsd: number; protocolCount: number }
interface Meta { from: string; to: string; firstSnapshotAt: string | null; partial: boolean }
const props = defineProps<{
  series: TvlPoint[]
  meta: Meta | null
  loading?: boolean
  error?: string | null
}>()
const emit = defineEmits<{ (e: 'retry'): void }>()

const W = 680
const H = 120
const PAD_T = 12
const PAD_B = 10
const HOUR_MS = 3600_000
// A gap = adjacent points more than ~1.5 buckets apart. Beyond it the line breaks.
const GAP_MS = HOUR_MS * 1.5

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtBucket = (iso: string): string => {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const hh = String(d.getUTCHours()).padStart(2, '0')
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} · ${hh}:00 UTC`
}
const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

const hasData = computed(() => props.series.length > 0)

// Window bounds for the x-axis: prefer the API's declared window, fall back to the
// data range. Time-based x is what makes gaps read as gaps.
const bounds = computed(() => {
  const fromMs = props.meta ? new Date(props.meta.from).getTime() : null
  const toMs = props.meta ? new Date(props.meta.to).getTime() : null
  if (fromMs && toMs && toMs > fromMs) return { fromMs, toMs }
  const ts = props.series.map((p) => new Date(p.t).getTime())
  const lo = Math.min(...ts)
  const hi = Math.max(...ts)
  return { fromMs: lo, toMs: hi > lo ? hi : lo + HOUR_MS }
})

// y-domain zoomed to the data (a TVL curve is read for its shape, not from $0);
// the tooltip always gives the exact figure so the zoom never misleads.
const yDomain = computed(() => {
  const vals = props.series.map((p) => p.tvlUsd)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min
  const pad = span > 0 ? span * 0.18 : Math.max(1, max * 0.01)
  return { lo: min - pad, hi: max + pad }
})

interface Pt { x: number; y: number; nx: number; t: string; tvl: number }
const pts = computed<Pt[]>(() => {
  const { fromMs, toMs } = bounds.value
  const { lo, hi } = yDomain.value
  const span = hi - lo || 1
  const usableH = H - PAD_T - PAD_B
  return props.series.map((p) => {
    const tMs = new Date(p.t).getTime()
    const nx = Math.min(1, Math.max(0, (tMs - fromMs) / (toMs - fromMs)))
    return {
      x: nx * W,
      y: H - PAD_B - ((p.tvlUsd - lo) / span) * usableH,
      nx,
      t: p.t,
      tvl: p.tvlUsd,
    }
  })
})

// Split into continuous segments, breaking wherever a bucket is missing.
const segments = computed<Pt[][]>(() => {
  const out: Pt[][] = []
  let cur: Pt[] = []
  const arr = pts.value
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) {
      const dt = new Date(arr[i].t).getTime() - new Date(arr[i - 1].t).getTime()
      if (dt > GAP_MS) {
        out.push(cur)
        cur = []
      }
    }
    cur.push(arr[i])
  }
  if (cur.length) out.push(cur)
  return out
})

const linePath = (seg: Pt[]): string =>
  seg.length < 2 ? '' : 'M ' + seg.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')
const areaPath = (seg: Pt[]): string => {
  if (seg.length < 2) return ''
  const base = (H - PAD_B).toFixed(1)
  return (
    `M ${seg[0].x.toFixed(1)} ${base} L ` +
    seg.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ') +
    ` L ${seg[seg.length - 1].x.toFixed(1)} ${base} Z`
  )
}
// Isolated points (a lone bucket between gaps) still deserve a mark.
const dots = computed<Pt[]>(() => segments.value.filter((s) => s.length === 1).map((s) => s[0]))
const lastPt = computed<Pt | null>(() => (pts.value.length ? pts.value[pts.value.length - 1] : null))

// ── hover ────────────────────────────────────────────────────────────────────
const hover = ref<number | null>(null)
function onMove(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const rx = (e.clientX - rect.left) / rect.width
  let best = 0
  let bestD = Infinity
  pts.value.forEach((p, i) => {
    const d = Math.abs(p.nx - rx)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  hover.value = best
}
const tip = computed(() => {
  if (hover.value == null) return null
  const p = pts.value[hover.value]
  if (!p) return null
  return {
    leftPct: p.nx * 100,
    flip: p.nx > 0.6,
    date: fmtBucket(p.t),
    tvl: formatUsd(p.tvl),
  }
})

const sinceLabel = computed(() =>
  props.meta?.partial ? fmtDate(props.meta.firstSnapshotAt) : '',
)
</script>

<template>
  <div>
    <!-- loading -->
    <div v-if="loading && !hasData" class="h-[120px] rounded-[10px] bg-[#202020] animate-pulse" />

    <!-- error -->
    <div v-else-if="error && !hasData" class="h-[120px] flex flex-col items-center justify-center text-center gap-[6px]">
      <p class="text-[12px]" style="color: var(--dig-red)">Couldn't load TVL history.</p>
      <button type="button" class="text-[12px] cursor-pointer" style="color: var(--dig-accent)" @click="emit('retry')">Retry</button>
    </div>

    <!-- cold start: no points yet -->
    <div v-else-if="!hasData" class="h-[120px] flex flex-col items-center justify-center text-center">
      <p class="text-[12.5px]" style="color: var(--dig-text)">Building network-TVL history</p>
      <p class="text-[11.5px] mt-[3px] max-w-[320px]" style="color: var(--dig-faint)">The first points are recorded on each refresh cycle — the 7-day curve fills in from here.</p>
    </div>

    <template v-else>
      <div class="relative w-full" @mousemove="onMove" @mouseleave="hover = null">
        <svg :viewBox="`0 0 ${W} ${H}`" width="100%" :height="H" preserveAspectRatio="none" class="block leading-none">
          <defs>
            <linearGradient id="tvlfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#B8E640" stop-opacity="0.20" />
              <stop offset="1" stop-color="#B8E640" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path v-for="(seg, i) in segments" :key="'a' + i" :d="areaPath(seg)" fill="url(#tvlfill)" />
          <path v-for="(seg, i) in segments" :key="'l' + i" :d="linePath(seg)" fill="none" stroke="#B8E640" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <circle v-for="(d, i) in dots" :key="'d' + i" :cx="d.x" :cy="d.y" r="2.5" fill="#B8E640" />
          <circle v-if="lastPt" :cx="lastPt.x" :cy="lastPt.y" r="3" fill="#B8E640" />
        </svg>

        <!-- hover guide + tooltip -->
        <div v-if="hover != null && pts[hover]" class="absolute top-0 bottom-0 w-px bg-[#5E5F5D] pointer-events-none" :style="{ left: pts[hover].nx * 100 + '%' }" />
        <div v-if="tip" class="absolute -top-1.5 pointer-events-none z-10"
             :style="{ left: tip.leftPct + '%', transform: `translate(${tip.flip ? '-100%' : '0'}, -100%)`, marginLeft: (tip.flip ? -8 : 8) + 'px' }">
          <div class="bg-[#161615] border border-[#37372F] rounded-[10px] px-3 py-2" style="box-shadow:0 8px 24px rgba(0,0,0,.5);">
            <p class="text-[11px] font-semibold" style="color: var(--dig-faint)">{{ tip.date }}</p>
            <div class="flex items-center gap-1.5 text-[12px] mt-1">
              <span class="w-2 h-2 rounded-[2px]" style="background:#B8E640;" />
              <span style="color: var(--dig-faint)">TVL</span>
              <span class="ml-auto font-bold tabular-nums" style="color: var(--dig-text)">{{ tip.tvl }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- honest "building history" note while the window isn't fully covered -->
      <p v-if="sinceLabel" class="text-[11px] mt-[8px]" style="color: var(--dig-faint)">
        Building history since {{ sinceLabel }} — the curve fills toward 7 days as snapshots accrue.
      </p>
    </template>
  </div>
</template>
