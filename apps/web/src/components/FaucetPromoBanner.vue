<script setup lang="ts">
// R3 (Lot R — T3-D2): the UPFRONT campaign card (founder amendment: the offer
// must be seen BEFORE the action). Renders ONLY while the campaign is live
// (active && remainingClaims > 0 from the server) — it disappears by itself
// when the budget is spent or the flag is off, never a stale promise. Shows
// remainingClaims: honest scarcity beats fake urgency.
import { onMounted } from "vue";
import { useFaucet } from "../composables/useFaucet";

const { campaign, campaignLive, refreshCampaign } = useFaucet();

onMounted(() => {
  void refreshCampaign();
});
</script>

<template>
  <div
    v-if="campaignLive && campaign"
    class="rounded-[16px] px-[20px] py-[16px] flex items-center justify-between gap-[14px] flex-wrap"
    style="background: var(--dig-surface); border: 1px solid rgba(213,255,47,0.35)"
  >
    <div class="flex flex-col gap-[3px] min-w-0">
      <div class="text-[13px] font-semibold flex items-center gap-[8px]" style="color: var(--dig-accent)">
        Earn {{ campaign.rewardXlm }} XLM
        <span
          v-if="campaign.network === 'testnet'"
          class="text-[10px] uppercase tracking-widest font-semibold px-[7px] py-[1px] rounded-[20px]"
          style="background: #2a2a27; color: var(--dig-faint)"
        >Testnet</span>
      </div>
      <div class="text-[12px]" style="color: var(--dig-faint)">
        Your first swap or Blend supply (≥ {{ campaign.minNotionalXlm }} XLM) earns
        {{ campaign.rewardXlm }} XLM — first-come, one reward per wallet.
      </div>
    </div>
    <div class="text-[12px] font-semibold whitespace-nowrap" style="color: var(--dig-text)">
      {{ campaign.remainingClaims }} claims left
    </div>
  </div>
</template>
