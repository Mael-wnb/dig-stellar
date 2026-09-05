<script setup lang="ts">
// StatusView — Lot ST, post-grant upgrade (Sept 2026): the visible face of the Lot E
// observability. One row per pipeline step and per RPC target, one tile per
// 15-min refresh run over 24h. ALL states/percentages come from
// GET /v1/ops/status — this view renders, it never re-derives a rule.
// Honest boundary in the footer: refresh-pipeline visibility, not an external
// uptime probe.
import { computed } from 'vue'
import StatusBar from '../status/StatusBar.vue'
import { useOpsStatus } from '../../composables/useOpsStatus'
import { useBridgeUpstreamPaused } from '../../composables/useBridge'
import { SEVERITY_STYLE } from '../../composables/useAlerts'
import type { OpsComponentState, OpsOverallState } from '../../api/ops'

const { data, state, error, lastRunAgeSeconds, reload } = useOpsStatus()

// Allbridge suffix: the SAME condition as the bridge staleness banner
// (useBridge single source) — UI copy only, the API stays neutral.
const { upstreamPaused } = useBridgeUpstreamPaused()

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function ageLabel(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  const min = Math.round(seconds / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

// Banner copy per overall.state (Lot ST refinement 4). The degraded count is
// the LATEST run's failed steps — derived from the payload's own segments,
// not recomputed from any rule.
const failedStepsLatestRun = computed(() => {
  const d = data.value
  if (!d || !d.overall.lastRunAt) return 0
  return d.components.filter(
    (c) =>
      c.kind === 'step' &&
      c.segments.some(
        (s) => s.runAt === d.overall.lastRunAt && s.state === 'failed',
      ),
  ).length
})

const bannerText = computed(() => {
  const d = data.value
  if (!d) return ''
  switch (d.overall.state) {
    case 'operational':
      return 'All pipeline systems operational'
    case 'degraded':
      return `Pipeline degraded — ${plural(failedStepsLatestRun.value, 'failed step')} on the latest run`
    case 'outage':
      return `Pipeline stalled — last refresh ${ageLabel(lastRunAgeSeconds.value)} ago`
    default:
      return 'No refresh data in the last 24h'
  }
})

const BANNER_STYLE: Record<OpsOverallState, { color: string; tint: string }> = {
  operational: { color: SEVERITY_STYLE.info.color, tint: SEVERITY_STYLE.info.tint },
  degraded: { color: SEVERITY_STYLE.warning.color, tint: SEVERITY_STYLE.warning.tint },
  outage: { color: SEVERITY_STYLE.critical.color, tint: SEVERITY_STYLE.critical.tint },
  unknown: { color: '#838583', tint: '#242422' },
}

const bannerStyle = computed(
  () => BANNER_STYLE[data.value?.overall.state ?? 'unknown'],
)

// Current-state chip per row (ok / degraded / failed / stale).
const CHIP_STYLE: Record<OpsComponentState, { color: string; tint: string }> = {
  ok: { color: SEVERITY_STYLE.info.color, tint: SEVERITY_STYLE.info.tint },
  degraded: { color: SEVERITY_STYLE.warning.color, tint: SEVERITY_STYLE.warning.tint },
  failed: { color: SEVERITY_STYLE.critical.color, tint: SEVERITY_STYLE.critical.tint },
  stale: { color: '#838583', tint: '#242422' },
}

const stepComponents = computed(
  () => data.value?.components.filter((c) => c.kind === 'step') ?? [],
)
const rpcComponents = computed(
  () => data.value?.components.filter((c) => c.kind === 'rpc') ?? [],
)

function rowLabel(c: { id: string; label: string }): string {
  // "(upstream paused)" is UI copy on the Allbridge row only, from the shared
  // bridge condition — never invented here, never sent by the API.
  if (c.id === 'step:allbridge' && upstreamPaused.value === true) {
    return `${c.label} (upstream paused)`
  }
  return c.label
}

function availabilityLabel(a: number | null): string {
  return a === null ? '—' : `${(a * 100).toFixed(2)}%`
}

const historySinceLabel = computed(() => {
  const iso = data.value?.historySince
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
})

const LEGEND = [
  { label: 'Operational', style: { background: SEVERITY_STYLE.info.color } },
  { label: 'Degraded', style: { background: SEVERITY_STYLE.warning.color } },
  { label: 'Failed', style: { background: SEVERITY_STYLE.critical.color } },
  {
    label: 'Missed cycle',
    style: {
      background:
        'repeating-linear-gradient(45deg, #3a3a37, #3a3a37 3px, #2c2c29 3px, #2c2c29 6px)',
    },
  },
  { label: 'No data', style: { background: 'transparent', border: '1px solid var(--dig-line)' } },
]
</script>

<template>
  <div class="max-w-[1180px] mx-auto px-[26px] py-[26px] max-md:px-[14px]" style="color: var(--dig-text)">
    <!-- No in-page h1: like every other view, the topbar owns the title.
         Only the subtitle line stays. -->
    <p class="mb-[14px] text-[12.5px]" style="color: var(--dig-faint)">
      Refresh pipeline and upstream targets, last 24 hours
    </p>

    <!-- Loading (F4) -->
    <div v-if="state === 'loading'" class="flex flex-col gap-[12px]">
      <div class="h-[64px] rounded-[14px] animate-pulse" style="background: var(--dig-surface)"></div>
      <div v-for="i in 6" :key="i" class="h-[52px] rounded-[14px] animate-pulse" style="background: var(--dig-surface)"></div>
    </div>

    <!-- Error (F4) -->
    <div
      v-else-if="state === 'error'"
      class="rounded-[14px] p-[20px] text-[13px]"
      style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
    >
      <p style="color: var(--dig-muted)">Could not load the system status.</p>
      <p class="mt-[4px] text-[12px]" style="color: var(--dig-faint)">{{ error }}</p>
      <button
        type="button"
        class="dig-chip mt-[12px] px-[12px] py-[6px] rounded-[10px] text-[12.5px] font-semibold cursor-pointer"
        @click="reload"
      >
        Retry
      </button>
    </div>

    <!-- Empty (F4): a payload with no runs in the window -->
    <div
      v-else-if="state === 'empty'"
      class="rounded-[14px] p-[20px] text-[13px]"
      style="background: var(--dig-surface); border: 1px solid var(--dig-line)"
    >
      No refresh data in the last 24h.
    </div>

    <template v-else-if="data">
      <!-- Overall banner + 24h counters -->
      <div
        class="rounded-[14px] px-[18px] py-[14px] flex items-center gap-[12px] flex-wrap"
        :style="{ background: bannerStyle.tint, border: `1px solid ${bannerStyle.color}55` }"
      >
        <span
          class="w-[9px] h-[9px] rounded-full flex-shrink-0"
          :style="{ background: bannerStyle.color }"
        />
        <span class="text-[14px] font-semibold" :style="{ color: bannerStyle.color }">
          {{ bannerText }}
        </span>
        <span
          v-if="data.overall.state !== 'outage' && data.overall.lastRunAt"
          class="text-[12px]"
          style="color: var(--dig-muted)"
        >
          Last refresh {{ ageLabel(lastRunAgeSeconds) }} ago
        </span>
        <span class="ml-auto flex gap-[8px] text-[11.5px] font-medium">
          <span
            class="px-[9px] py-[3px] rounded-full"
            :style="{
              background: 'var(--dig-surface-2, #242422)',
              color: data.overall.missedCycles24h > 0 ? 'var(--dig-muted)' : 'var(--dig-faint)',
            }"
          >
            {{ plural(data.overall.missedCycles24h, 'missed cycle') }} · 24h
          </span>
          <span
            class="px-[9px] py-[3px] rounded-full"
            :style="{
              background: 'var(--dig-surface-2, #242422)',
              color: data.overall.failedSteps24h > 0 ? 'var(--dig-muted)' : 'var(--dig-faint)',
            }"
          >
            {{ plural(data.overall.failedSteps24h, 'failed step') }} · 24h
          </span>
        </span>
      </div>

      <!-- Legend -->
      <div class="flex flex-wrap gap-x-[16px] gap-y-[6px] mt-[14px] text-[11.5px]" style="color: var(--dig-faint)">
        <span v-for="l in LEGEND" :key="l.label" class="flex items-center gap-[6px]">
          <span class="w-[10px] h-[10px] rounded-[2px] inline-block" :style="l.style" />
          {{ l.label }}
        </span>
      </div>

      <!-- Groups -->
      <section
        v-for="group in [
          { title: 'Refresh pipeline', comps: stepComponents },
          { title: 'Upstream RPC targets', comps: rpcComponents },
        ]"
        :key="group.title"
        class="mt-[22px]"
      >
        <h2
          class="text-[10.5px] font-semibold uppercase tracking-[0.09em] mb-[8px]"
          style="color: var(--dig-faint)"
        >
          {{ group.title }}
        </h2>

        <div
          class="rounded-[14px] divide-y"
          style="background: var(--dig-surface); border: 1px solid var(--dig-line); --tw-divide-opacity: 1"
        >
          <div
            v-for="c in group.comps"
            :key="c.id"
            class="px-[16px] py-[8px]"
            style="border-color: var(--dig-line-soft)"
          >
            <div class="flex items-center gap-[10px] mb-[5px] flex-wrap">
              <span class="text-[13px] font-semibold min-w-[150px]">{{ rowLabel(c) }}</span>
              <span
                class="text-[10.5px] font-semibold uppercase tracking-[.04em] px-[7px] py-px rounded-full"
                :style="{ background: CHIP_STYLE[c.state].tint, color: CHIP_STYLE[c.state].color }"
              >
                {{ c.state }}
              </span>
              <span class="ml-auto text-[12px] font-mono-geist" style="color: var(--dig-muted)">
                {{ availabilityLabel(c.availability24h) }}
              </span>
            </div>
            <StatusBar
              :runs="data.runs"
              :segments="c.segments"
              :gaps="data.gaps"
              :no-data-before="data.noDataBefore"
              :generated-at="data.generatedAt"
              :cadence-minutes="data.cadenceMinutes"
            />
          </div>

          <!-- Axis rendered ONCE per group (2b density), not per row. -->
          <div
            class="flex justify-between px-[16px] py-[6px] text-[10.5px]"
            style="color: var(--dig-faint); border-color: var(--dig-line-soft)"
          >
            <span>24h ago</span>
            <span>12h</span>
            <span>now</span>
          </div>
        </div>
      </section>

      <!-- Honest boundary footer (verbatim copy — Lot ST refinement 6) -->
      <p class="mt-[20px] text-[12px] leading-[1.6]" style="color: var(--dig-faint)">
        Refresh cadence 15 min · history since {{ historySinceLabel }} · This page
        reflects the indexer's refresh pipeline and its outbound calls. It is not
        an external uptime probe of the API or the dashboard.
      </p>
    </template>
  </div>
</template>
