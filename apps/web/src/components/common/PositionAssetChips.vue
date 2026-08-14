<script setup lang="ts">
// PositionAssetChips — H6 (Lot H, T3-D3). The composition behind a position's
// USD rollup: one chip per stored supply/borrow leg (logo + symbol + exact
// amount), e.g. "Supplied: 5 XLM · Borrowed: 3 USDC".
//
// Display honesty rules this component holds to:
//  • amounts are the API's stored values, printed exactly — nothing rounded to
//    a friendlier number, nothing derived, nothing invented,
//  • EVERY leg is listed — a position with three supplied assets shows three
//    chips; there is no "top asset" truncation that would hide the rest,
//  • no legs (older snapshot, or an asset the indexer never resolved) renders
//    nothing at all rather than a placeholder implying a known composition.
// The USD totals stay where they are; these chips only add the *what*.
import { computed } from 'vue'
import type { WalletPositionItem } from '../../types/wallet'
import { displaySymbol, formatTokenAmount } from '../../utils/format'
import BrandLogo from './BrandLogo.vue'

const props = withDefaults(
  defineProps<{
    positions?: WalletPositionItem[] | null
    size?: number // chip logo px
    dense?: boolean // dashboard variant — smaller type, tighter gaps
  }>(),
  { size: 16, dense: false },
)

// Supplied first, then borrowed — matching the API's leg order. Any future
// position family lands in "other" instead of being silently dropped.
const SIDES = [
  { side: 'supplied', label: 'Supplied', color: 'var(--dig-green)' },
  { side: 'borrowed', label: 'Borrowed', color: 'var(--dig-amber)' },
  { side: 'other', label: 'Other', color: 'var(--dig-faint)' },
] as const

const groups = computed(() =>
  SIDES.map((g) => ({
    ...g,
    legs: (props.positions ?? []).filter((p) => p.side === g.side),
  })).filter((g) => g.legs.length > 0),
)
</script>

<template>
  <div
    v-if="groups.length"
    class="flex items-center flex-wrap"
    :class="dense ? 'gap-x-[8px] gap-y-[4px]' : 'gap-x-[10px] gap-y-[5px]'"
  >
    <div
      v-for="(g, gi) in groups"
      :key="g.side"
      class="flex items-center flex-wrap"
      :class="dense ? 'gap-[5px]' : 'gap-[6px]'"
    >
      <!-- Separator between the supplied and borrowed runs ("·") -->
      <span v-if="gi > 0" :style="{ color: 'var(--dig-line)' }" class="select-none">·</span>

      <span
        class="font-semibold uppercase tracking-[0.04em]"
        :class="dense ? 'text-[10px]' : 'text-[10.5px]'"
        :style="{ color: g.color }"
      >{{ g.label }}</span>

      <span
        v-for="(leg, i) in g.legs"
        :key="`${leg.positionType}-${leg.assetContractId ?? leg.assetSymbol ?? i}`"
        class="flex items-center rounded-[7px]"
        :class="dense ? 'gap-[4px] px-[5px] py-[2px] text-[11px]' : 'gap-[5px] px-[6px] py-[3px] text-[12px]'"
        style="background: var(--dig-surface-2); border: 1px solid var(--dig-line-soft)"
        :title="leg.amountUsd !== null ? `${formatTokenAmount(leg.amountScaled)} ${displaySymbol(leg.assetSymbol)}` : undefined"
      >
        <BrandLogo
          :primary="leg.logoUrl"
          :letter="(displaySymbol(leg.assetSymbol) || '•').charAt(0)"
          tint="#242422"
          color="#B7B3AB"
          :size="size"
          :radius="5"
          :font-size="Math.round(size * 0.5)"
          :img-scale="0.72"
        />
        <span class="tabular-nums font-semibold">{{ formatTokenAmount(leg.amountScaled) }}</span>
        <span style="color: var(--dig-faint)">{{ displaySymbol(leg.assetSymbol) }}</span>
      </span>
    </div>
  </div>
</template>
