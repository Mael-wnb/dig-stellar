<script setup lang="ts">
// StatusBar — Lot ST. The Statuspage-style segmented bar: one tile per refresh
// run on the shared `runs` axis, plus one grey hatched tile PER missed cycle
// (so the bar's width stays proportional to time) and a transparent outlined
// slot when this component has no row for a run on the axis (never a
// synthesized state). Dumb by design: every state/colour decision was made by
// the API; this maps states to tiles.
//
// Beta tooltip = native `title` + `aria-label`, tiles keyboard-focusable
// (tabindex=0) — no custom tooltip component yet.
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
  const byRunAt = new Map(props.segments.map((s) => [s.runAt, s]))
  const gapAfter = new Map(props.gaps.map((g) => [g.after, g]))
  const out: Tile[] = []

  props.runs.forEach((run, i) => {
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

    // Gap tiles sit between this run and the next: one per missed cycle.
    const gap = gapAfter.get(run.runAt)
    if (gap && i < props.runs.length - 1) {
      for (let m = 0; m < gap.missedCycles; m += 1) {
        out.push({
          kind: 'gap',
          key: `g-${run.runAt}-${m}`,
          label: `Missed cycle (no refresh between ${timeLabel(gap.after)} and ${timeLabel(gap.before)})`,
        })
      }
    }
  })

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
      class="flex items-stretch gap-[2px] h-[26px]"
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

    <!-- Axis labels: static window markers (the axis is the 24h window). -->
    <div
      class="flex justify-between mt-[5px] text-[10.5px]"
      :style="{ minWidth: trackMinWidth, color: 'var(--dig-faint)' }"
    >
      <span>24h ago</span>
      <span>12h</span>
      <span>now</span>
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

/* Run on the axis but no row for THIS component: transparent outline only. */
.dig-status-tile-empty {
  background: transparent;
  border: 1px solid var(--dig-line);
}

.dig-status-tile:focus-visible {
  outline: 2px solid var(--dig-accent);
  outline-offset: 1px;
}
</style>
