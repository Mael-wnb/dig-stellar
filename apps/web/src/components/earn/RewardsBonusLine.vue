<script setup lang="ts">
// RewardsBonusLine — Lot EP (EP5). ONE separate line under an action tile:
// "Dig bonus: XLM paid daily from the points pool (see Earn)". Rendered only
// while GET /campaign rules.rewards.enabled is true; never a percentage, never
// an amount, never merged with the APY node next to it (the APY stays its own
// DOM node with its own copy). Nothing is computed here: the line is static
// copy gated by one API boolean.
import { computed } from 'vue'
import type { CampaignRules } from '../../api/campaign'

const props = defineProps<{ rules: CampaignRules | null | undefined }>()
const enabled = computed(() => props.rules?.rewards?.enabled === true)
</script>

<template>
  <div
    v-if="enabled"
    class="text-[11px] mt-[6px] font-medium"
    style="color: var(--dig-accent)"
    data-testid="rewards-bonus"
  >
    Dig bonus: XLM paid daily from the points pool (see Earn)
  </div>
</template>
