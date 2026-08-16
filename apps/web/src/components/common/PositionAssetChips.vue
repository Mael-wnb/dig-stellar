<script setup lang="ts">
// PositionAssetChips — H6, compacted in H7 (Lot H, T3-D3). The composition
// behind a position's USD rollup: one chip per stored supply/borrow leg
// (logo + symbol + amount), e.g. "240k XLM · 10,187 USDC".
//
// Display honesty rules this component holds to:
//  • amounts come only from the API's stored values — nothing derived, nothing
//    invented,
//  • the chip shows a COMPACT amount and the hover title shows the EXACT stored
//    amount (H7). Precision is relocated, never discarded: the readable form is
//    always one hover away from the real number,
//  • EVERY leg is listed — a position with three supplied assets shows three
//    chips; there is no "top asset" truncation that would hide the rest,
//  • no legs (older snapshot, or an asset the indexer never resolved) renders
//    nothing at all rather than a placeholder implying a known composition.
// The USD totals stay where they are; these chips only add the *what*.
import { computed } from 'vue'
import type { WalletPositionItem } from '../../types/wallet'
import {
  displaySymbol,
  formatTokenAmountCompact,
  formatTokenAmountExact,
} from '../../utils/format'
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

// H7: the SUPPLIED/BORROWED labels earn their space only when there are two
// sides to tell apart. A supply-only position drops the label — the chips are
// unambiguous on their own. A position that is somehow NOT supply-only keeps
// its label even when alone, because bare chips would read as "supplied" by
// default, which is exactly the misreading the labels exist to prevent.
const showLabels = computed(
  () => groups.value.length > 1 || groups.value[0]?.side !== 'supplied',
)

// Hover carries what the chip compacts away: side, exact stored amount, symbol.
function legTitle(leg: WalletPositionItem, sideLabel: string): string {
  return `${sideLabel} ${formatTokenAmountExact(leg.amountScaled)} ${displaySymbol(leg.assetSymbol)}`
}
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
        v-if="showLabels"
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
        :title="legTitle(leg, g.label)"
      >
        <BrandLogo
          variant="asset"
          :primary="leg.logoUrl"
          :letter="(displaySymbol(leg.assetSymbol) || '•').charAt(0)"
          tint="#242422"
          color="#B7B3AB"
          :size="size"
          :font-size="Math.round(size * 0.5)"
        />
        <span class="tabular-nums font-semibold">{{ formatTokenAmountCompact(leg.amountScaled) }}</span>
        <span style="color: var(--dig-faint)">{{ displaySymbol(leg.assetSymbol) }}</span>
      </span>
    </div>
  </div>
</template>
