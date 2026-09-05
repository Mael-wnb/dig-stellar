<script setup lang="ts">
// StatusBar — Lot ST. The Statuspage-style segmented bar: one tile per refresh
// run, one grey hatched tile PER missed cycle — including the open-ended
// TRAILING gap (before: null — refresh overdue since the last run) and the
// real leading gap (window start → first run) — plus empty "no data" slots for
// the pre-history span (noDataBefore, fresh deploy) and for a run this
// component has no row for. Tile position ≈ time position along the 24h axis;
// a stalled pipeline reads 1 green + ~93 hatched, never "1 green + nothing"
// (2b fix). Dumb by design: every state/count decision was made by the API.
//
// Beta tooltip = native `title` + `aria-label`, tiles keyboard-focusable
// (tabindex=0). The 24h-ago/12h/now axis labels are rendered ONCE per group by
// StatusView, not here.
import { computed } from 'vue'
import { SEVERITY_STYLE } from '../../composables/useAlerts'
import type {
  OpsRpcSegment,
  OpsSegmentState,
  OpsStatusGap,
  OpsStatusSegment,
  OpsStepSegment,
} from '../../api/ops'

const props = defineProps<{
  runs: Array<{ runAt: string }>
  segments: OpsStatusSegment[]
  gaps: OpsStatusGap[]
  noDataBefore: string | null
  generatedAt: string
  cadenceMinutes: number
}>()

// Segment colours come from the SAME palette the alert severities use — the
// house green/amber/red, no new colour constants.
const STATE_COLOR: Record<OpsSegmentState, string> = {
  ok: SEVERITY_STYLE.info.color,
  degraded: SEVERITY_STYLE.warning.color,
  failed: SEVERITY_STYLE.critical.color,
}

type Tile =
  | { kind: 'segment'; key: string; state: OpsSegmentState; label: string }
  | { kind: 'gap'; key: string; label: string }
  | { kind: 'empty'; key: string; label: string }

// Viewer-local time for the visible tooltip, UTC alongside (title only).
function timeLabel(iso: string): string {
  const d = new Date(iso)
  const local = d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${local} (${d.toISOString().slice(0, 16).replace('T', ' ')} UTC)`
}

function segmentDetails(s: OpsStatusSegment): string {
  if ('durationMs' in s) {
    const step = s as OpsStepSegment
    const dur = `${(step.durationMs / 1000).toFixed(1)}s`
    return step.message ? `${dur} — ${step.message}` : dur
  }
  const rpc = s as OpsRpcSegment
  return `${rpc.calls} calls, ${rpc.errors} errors, p95 ${rpc.p95Ms}ms`
}

const tiles = computed<Tile[]>(() => {
  const cadenceMs = props.cadenceMinutes * 60_000
  const windowStartMs = new Date(props.generatedAt).getTime() - 24 * 3_600_000
  const runsSet = new Set(props.runs.map((r) => r.runAt))
  const byRunAt = new Map(props.segments.map((s) => [s.runAt, s]))
  // Between-run gaps key on the run they follow; the leading gap's `after` is
  // the window start (not a run); the trailing gap has `before: null`.
  const gapAfterRun = new Map(
    props.gaps.filter((g) => g.before !== null && runsSet.has(g.after)).map((g) => [g.after, g]),
  )
  const leadingGap = props.gaps.find((g) => g.before !== null && !runsSet.has(g.after)) ?? null
  const trailingGap = props.gaps.find((g) => g.before === null) ?? null
  const out: Tile[] = []

  // Pre-history "no data" slots (fresh deploy): window start → first run.
  if (props.noDataBefore && props.runs.length) {
    const firstMs = new Date(props.runs[0].runAt).getTime()
    const slots = Math.max(0, Math.floor((firstMs - windowStartMs) / cadenceMs))
    for (let m = 0; m < slots; m += 1) {
      out.push({
        kind: 'empty',
        key: `nd-${m}`,
        label: `No data — history starts ${timeLabel(props.noDataBefore)}`,
      })
    }
  }

  // Leading REAL gap (history predates the window; runs were expected).
  if (leadingGap) {
    for (let m = 0; m < leadingGap.missedCycles; m += 1) {
      out.push({
        kind: 'gap',
        key: `lg-${m}`,
        label: `Missed cycle (no refresh between ${timeLabel(leadingGap.after)} and ${timeLabel(leadingGap.before!)})`,
      })
    }
  }

  props.runs.forEach((run) => {
    const segment = byRunAt.get(run.runAt)
    if (segment) {
      out.push({
        kind: 'segment',
        key: `s-${run.runAt}`,
        state: segment.state,
        label: `${timeLabel(run.runAt)} — ${segment.state} — ${segmentDetails(segment)}`,
      })
    } else {
      out.push({
        kind: 'empty',
        key: `e-${run.runAt}`,
        label: `${timeLabel(run.runAt)} — No data for this run`,
      })
    }

    const gap = gapAfterRun.get(run.runAt)
    if (gap) {
      for (let m = 0; m < gap.missedCycles; m += 1) {
        out.push({
          kind: 'gap',
          key: `g-${run.runAt}-${m}`,
          label: `Missed cycle (no refresh between ${timeLabel(gap.after)} and ${timeLabel(gap.before!)})`,
        })
      }
    }
  })

  // Open-ended trailing gap: the refresh is overdue RIGHT NOW.
  if (trailingGap) {
    for (let m = 0; m < trailingGap.missedCycles; m += 1) {
      out.push({
        kind: 'gap',
        key: `tg-${m}`,
        label: `Missed cycle — refresh overdue (last run ${timeLabel(trailingGap.after)})`,
      })
    }
  }

  return out
})

// ≥4px tiles at 390px (Lot AA): the track has a min-width so the bar scrolls
// inside its own container instead of squeezing tiles below readability.
const trackMinWidth = computed(() => `${tiles.value.length * 6}px`)
</script>

<template>
  <!-- The scroll container: the BAR scrolls, the body never does (Lot AA). -->
  <div class="overflow-x-auto dig-scroll">
    <div
      class="flex items-stretch gap-[2px] h-[18px]"
      :style="{ minWidth: trackMinWidth }"
      role="img"
      :aria-label="`${runs.length} refresh runs over the last 24 hours`"
    >
      <span
        v-for="tile in tiles"
        :key="tile.key"
        tabindex="0"
        class="dig-status-tile flex-1 rounded-[2px] min-w-[4px] max-w-[14px]"
        :class="{
          'dig-status-tile-gap': tile.kind === 'gap',
          'dig-status-tile-empty': tile.kind === 'empty',
        }"
        :style="
          tile.kind === 'segment'
            ? { background: STATE_COLOR[tile.state] }
            : undefined
        "
        :title="tile.label"
        :aria-label="tile.label"
      />
    </div>
  </div>
</template>

<style scoped>
/* Grey hatched = a missed expected run (returned as a gap, NOT a red segment). */
.dig-status-tile-gap {
  background: repeating-linear-gradient(
    45deg,
    #3a3a37,
    #3a3a37 3px,
    #2c2c29 3px,
    #2c2c29 6px
  );
}

/* No data: pre-history slot, or a run this component has no row for. */
.dig-status-tile-empty {
  background: transparent;
  border: 1px solid var(--dig-line);
}

.dig-status-tile:focus-visible {
  outline: 2px solid var(--dig-accent);
  outline-offset: 1px;
}
</style>
