<script setup lang="ts">
// HealthFactorGauge — H7 (Lot H, T3-D3). The Blend health factor as a small
// horizontal gauge instead of a bare number.
//
// Scale: 1.0 (liquidation) → 2.0, clamped. Anything at or above 2.0 sits at the
// far right; anything at or below 1.0 sits hard left on the liquidation edge.
// The gradient stops are the SAME thresholds utils/health.ts colours by
// (red < 1.2, amber 1.2–1.5, green >= 1.5), so the bar and the number can never
// disagree — 1.2 lands exactly on amber, 1.5 exactly on green.
//
// Honesty rule: null health factor = no debt = NOT a healthy position, it is an
// absent one. It renders as today's "No borrow" text with NO gauge — a full
// green bar there would invent a safety margin the user does not have.
import { computed } from 'vue'
import { hfDisplay } from '../../utils/health'

const props = withDefaults(
  defineProps<{
    healthFactor: number | null
    dense?: boolean // dashboard variant — shorter bar, smaller type
  }>(),
  { dense: false },
)

const SCALE_MIN = 1.0 // liquidation
const SCALE_MAX = 2.0 // clamped ceiling — above this the risk read is the same

const display = computed(() => hfDisplay(props.healthFactor))
const hasGauge = computed(
  () => props.healthFactor !== null && Number.isFinite(props.healthFactor),
)

// Marker position, 0–1 across the scale.
const markerPct = computed(() => {
  const hf = props.healthFactor
  if (hf === null || !Number.isFinite(hf)) return 0
  const clamped = Math.min(Math.max(hf, SCALE_MIN), SCALE_MAX)
  return ((clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100
})

const barWidth = computed(() => (props.dense ? 48 : 68))
const barHeight = computed(() => (props.dense ? 5 : 6))

// Threshold-anchored continuous gradient: 1.2 -> 20%, 1.5 -> 50% on this scale.
const GRADIENT =
  'linear-gradient(90deg, var(--dig-red) 0%, var(--dig-amber) 20%, var(--dig-green) 50%, var(--dig-green) 100%)'

const title = computed(() => {
  const hf = props.healthFactor
  if (hf === null || !Number.isFinite(hf)) return 'No borrow, no liquidation risk'
  const suffix = hf >= SCALE_MAX ? ' (scale clamped at 2.00)' : ''
  return `Health factor ${hf.toFixed(4)}, liquidation at 1.00${suffix}`
})
</script>

<template>
  <!-- No debt: text only, never a gauge -->
  <span
    v-if="!hasGauge"
    class="font-bold tabular-nums"
    :class="dense ? 'text-[11.5px]' : 'text-[13px]'"
    :style="{ color: display.color }"
    :title="title"
  >{{ display.label }}</span>

  <span
    v-else
    class="inline-flex items-center justify-end"
    :class="dense ? 'gap-[6px]' : 'gap-[8px]'"
    :title="title"
  >
    <span
      class="relative rounded-full flex-shrink-0"
      :style="{ width: `${barWidth}px`, height: `${barHeight}px`, background: GRADIENT }"
    >
      <!-- Marker: light stem on a dark outline so it stays visible over red,
           amber and green alike. -->
      <span
        class="absolute rounded-full"
        :style="{
          left: `${markerPct}%`,
          top: `${-barHeight / 2}px`,
          width: '2px',
          height: `${barHeight * 2}px`,
          marginLeft: '-1px',
          background: 'var(--dig-text)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
        }"
      ></span>
    </span>
    <span
      class="font-bold tabular-nums"
      :class="dense ? 'text-[11.5px]' : 'text-[13px]'"
      :style="{ color: display.color }"
    >{{ display.label }}</span>
  </span>
</template>
