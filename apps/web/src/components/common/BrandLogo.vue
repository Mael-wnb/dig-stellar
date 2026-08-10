<script setup lang="ts">
// BrandLogo — F3 (Lot F). One brand/asset mark with an honest fallback chain:
//   backend logoUrl (primary) → bundled asset (fallback) → monogram letter.
// A dead URL (@error) drops to the next candidate, so a broken-image icon can
// never render. Sizing is prop-driven so each call site keeps its exact look.
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    primary?: string | null // backend-served logoUrl (preferred)
    fallback?: string | null // bundled/local logo (e.g. venueTheme)
    letter: string // monogram shown when no image resolves
    tint: string // chip background
    color: string // monogram/text color
    size?: number // px (square)
    radius?: number // px
    fontSize?: number // px, monogram letter
    imgScale?: number // 0–1, image size relative to the chip
  }>(),
  { size: 42, radius: 12, fontSize: 18, imgScale: 0.6 },
)

// Track which candidate URLs have failed to load so we skip past them.
const failed = ref<Set<string>>(new Set())

// Reset failures if the inputs change (e.g. list re-renders with new data).
watch(
  () => [props.primary, props.fallback],
  () => {
    failed.value = new Set()
  },
)

const activeSrc = computed<string | null>(() => {
  const candidates = [props.primary, props.fallback].filter(
    (u): u is string => !!u,
  )
  return candidates.find((u) => !failed.value.has(u)) ?? null
})

function onError() {
  const src = activeSrc.value
  if (src) failed.value = new Set(failed.value).add(src)
}
</script>

<template>
  <span
    class="flex items-center justify-center font-bold flex-shrink-0 overflow-hidden"
    :style="{
      background: tint,
      color,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: `${radius}px`,
      fontSize: `${fontSize}px`,
    }"
  >
    <img
      v-if="activeSrc"
      :src="activeSrc"
      alt=""
      class="object-contain"
      :style="{ width: `${imgScale * 100}%`, height: `${imgScale * 100}%` }"
      @error="onError"
    />
    <template v-else>{{ letter }}</template>
  </span>
</template>
