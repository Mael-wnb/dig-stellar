<script setup lang="ts">
// PairLogo — F5 (Lot F). DexScreener-style overlapped asset marks, composed
// from BrandLogo so the honest fallback chain (backend logoUrl → bundled asset
// → monogram) is inherited unchanged.
//   • AMM pools    → the two pair assets
//   • yield vaults → the underlying asset (single mark)
//   • lending      → not used here; keep a plain BrandLogo (protocol mark)
// Q1 (Lot Q): marks are circles (BrandLogo variant="asset" — tokens are round,
// apps are square). Only the overlapping (front) marks carry a thin ring in the
// chip-surface colour, so the overlap reads cleanly without framing the back
// mark. No protocol badge: the venue name is already written next to the mark
// at every call site, so a third mini-logo would just be clutter.
import { computed } from 'vue'
import BrandLogo from './BrandLogo.vue'

interface AssetMark {
  primary?: string | null // backend-served asset logoUrl (preferred)
  fallback?: string | null // bundled/local logo
  letter: string // monogram shown when no image resolves
  tint?: string // chip background (defaults to neutral asset chip)
  color?: string // monogram/text colour
}

const props = withDefaults(
  defineProps<{
    assets: AssetMark[] // 1 (vault) or 2 (pair) marks
    size?: number // px, each asset chip (diameter)
    fontSize?: number // px, monogram letter
    overlap?: number // 0–1, horizontal advance per chip (0.72 → ~28% overlap)
    ring?: string // ring/separator colour (the chip surface)
  }>(),
  {
    size: 30,
    fontSize: 12,
    overlap: 0.72,
    ring: 'var(--dig-surface)',
  },
)

// Neutral asset chip, matching the reserve rows elsewhere in the app.
const ASSET_TINT = '#242422'
const ASSET_COLOR = '#B7B3AB'

const step = computed(() => props.size * props.overlap)
const width = computed(
  () => props.size + step.value * Math.max(0, props.assets.length - 1),
)
</script>

<template>
  <span
    class="relative inline-flex flex-shrink-0"
    :style="{ width: `${width}px`, height: `${size}px` }"
  >
    <span
      v-for="(a, i) in assets"
      :key="i"
      class="absolute top-0 rounded-full"
      :style="{
        left: `${i * step}px`,
        zIndex: i + 1,
        boxShadow: i > 0 ? `0 0 0 2px ${ring}` : 'none',
      }"
    >
      <BrandLogo
        variant="asset"
        :primary="a.primary"
        :fallback="a.fallback"
        :letter="a.letter"
        :tint="a.tint ?? ASSET_TINT"
        :color="a.color ?? ASSET_COLOR"
        :size="size"
        :font-size="fontSize"
      />
    </span>
  </span>
</template>
