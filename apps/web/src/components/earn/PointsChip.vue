<script setup lang="ts">
// PointsChip — Lot EP (EP2). "+N pts" rendered ONLY from a value the API
// served (rules.actions[kind].basePoints via pointsForActionIn, or a payload
// field). Dumb by design: props in, nothing computed, no composable — so it
// mounts as a SIBLING next to an APY node without touching it, and renders
// nothing at all when the campaign is inactive (points === null).
//
// The API's disclaimer travels with the chip as its title attribute; the
// mounting surface renders it ONCE as visible text (founder ruling 2026-10-21:
// once per surface, not under every chip). Points are never folded into a
// yield figure.
defineProps<{
  /** Base points from the API rules block; null = campaign inactive/unknown → render nothing. */
  points: number | null
  /** The API's disclaimer string (CampaignState.disclaimer) — the chip's title. */
  disclaimer: string | null
  /** Short context line rendered after the pill (e.g. "per verified swap"). */
  caption?: string
}>()
</script>

<template>
  <div v-if="points !== null" class="flex items-center gap-[8px] flex-wrap" data-testid="points-chip">
    <span
      class="inline-flex items-center h-[22px] px-[9px] rounded-full text-[11.5px] font-bold tabular-nums"
      style="background: rgba(213,255,47,0.12); border: 1px solid rgba(213,255,47,0.35); color: var(--dig-accent)"
      :title="disclaimer ?? undefined"
    >
      +{{ points }} pts
    </span>
    <span v-if="caption" class="text-[11px]" style="color: var(--dig-faint)">{{ caption }}</span>
  </div>
</template>
