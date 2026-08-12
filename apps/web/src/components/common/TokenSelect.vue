<script setup lang="ts">
// TokenSelect — H3 (Lot H, T3-D3). Presentation-only custom asset picker for
// the swap widget, replacing the native <select>. The selectable set is
// EXACTLY the whitelist array the widget passes in (`assets`) — this component
// adds zero assets and zero fetches; it emits the same swapAssetKey the
// <select> bound before. Display names and monogram chips are cosmetic
// metadata (BrandLogo's neutral asset chip, the F5 convention).
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import BrandLogo from './BrandLogo.vue'
import { swapAssetKey, type TestnetSwapAsset } from '../../config/testnetSwapPairs'

const props = defineProps<{
  modelValue: string
  assets: TestnetSwapAsset[]
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

// Canonical display names for the vetted set — cosmetic only. An asset whose
// code isn't mapped simply shows its code (nothing is hidden or invented).
const ASSET_NAME: Record<string, string> = {
  XLM: 'Stellar Lumens',
  USDC: 'USD Coin (Circle)',
  EURC: 'Euro Coin (Circle)',
  AQUA: 'Aquarius',
  yXLM: 'Yield XLM (Ultra Capital)',
  PYUSD: 'PayPal USD (Paxos)',
}
function nameFor(a: TestnetSwapAsset): string {
  return ASSET_NAME[a.code] ?? a.code
}

const open = ref(false)
// Open upward when the space below the trigger can't fit the panel (e.g. the
// To selector near the bottom of ActionModal) — otherwise it clips.
const dropUp = ref(false)
const PANEL_MAX_H = 264 + 6
const root = ref<HTMLElement | null>(null)

function toggle() {
  if (!open.value && root.value) {
    const r = root.value.getBoundingClientRect()
    dropUp.value = window.innerHeight - r.bottom < PANEL_MAX_H && r.top > PANEL_MAX_H
  }
  open.value = !open.value
}

const selected = computed<TestnetSwapAsset>(
  () => props.assets.find((a) => swapAssetKey(a) === props.modelValue) ?? props.assets[0],
)

function pick(a: TestnetSwapAsset) {
  emit('update:modelValue', swapAssetKey(a))
  open.value = false
}

// Click-outside + Escape close.
function onDocDown(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
watch(open, (v) => {
  if (v) document.addEventListener('mousedown', onDocDown)
  else document.removeEventListener('mousedown', onDocDown)
})
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown))
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
</script>

<template>
  <div ref="root" class="relative flex-shrink-0" @keydown="onKeydown">
    <button
      type="button"
      class="flex items-center gap-[7px] h-[36px] pl-[6px] pr-[10px] rounded-[999px] cursor-pointer transition-colors"
      style="background: var(--dig-surface-3); border: 1px solid var(--dig-line)"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <BrandLogo :letter="selected.code.slice(0, 1)" tint="#242422" color="#B7B3AB" :size="24" :radius="999" :font-size="11" />
      <span class="text-[14px] font-bold" style="color: var(--dig-text)">{{ selected.code }}</span>
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round"
        class="transition-transform"
        :style="{ color: 'var(--dig-faint)', transform: open ? 'rotate(180deg)' : 'none' }"
      ><path d="M6 9l6 6 6-6"/></svg>
    </button>

    <div
      v-if="open"
      role="listbox"
      class="absolute right-0 z-20 w-[232px] max-h-[264px] overflow-y-auto dig-scroll rounded-[14px] p-[6px] flex flex-col gap-[2px]"
      :class="dropUp ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'"
      style="background: var(--dig-surface-2); border: 1px solid var(--dig-line); box-shadow: 0 18px 40px -18px rgba(0,0,0,.6)"
    >
      <button
        v-for="a in assets"
        :key="swapAssetKey(a)"
        type="button"
        role="option"
        :aria-selected="swapAssetKey(a) === modelValue"
        class="dig-row flex items-center gap-[10px] px-[8px] py-[7px] rounded-[10px] cursor-pointer text-left"
        @click="pick(a)"
      >
        <BrandLogo :letter="a.code.slice(0, 1)" tint="#242422" color="#B7B3AB" :size="28" :radius="999" :font-size="12" />
        <span class="min-w-0">
          <span class="block text-[13px] font-bold leading-[1.2]" style="color: var(--dig-text)">{{ a.code }}</span>
          <span class="block text-[11px] truncate" style="color: var(--dig-faint)">{{ nameFor(a) }}</span>
        </span>
        <svg
          v-if="swapAssetKey(a) === modelValue"
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--dig-accent)" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" class="ml-auto flex-shrink-0"
        ><path d="M20 6L9 17l-5-5"/></svg>
      </button>
    </div>
  </div>
</template>
