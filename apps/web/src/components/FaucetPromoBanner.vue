<script setup lang="ts">
// R3 (Lot R) / R3b redesign: the UPFRONT campaign card (the offer must be seen
// BEFORE the action) — now with a real call to action. Renders ONLY while the
// campaign is live (active && remainingClaims > 0, server-computed) and, when
// the server sets a deadline, only until it passes — the countdown is DERIVED
// from the server's endsAt (which also closes eligibility server-side); with
// no endsAt there is no time pressure shown at all (honesty rule: no fake
// urgency). Disappears by itself when the budget is spent or the flag is off.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useFaucet } from "../composables/useFaucet";
import { useModals } from "../composables/useModals";
import BrandLogo from "./common/BrandLogo.vue";

// Same canonical Stellar mark TokenSelect uses (F3 logo source); BrandLogo
// falls back to the monogram if the URL dies.
const XLM_LOGO =
  "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/stellar/info/logo.png";

const { campaign, campaignLive, refreshCampaign } = useFaucet();
const { openAction } = useModals();

// --- Countdown (R3b): ticks client-side every second; the END VALUE is
// always the server's endsAt. At zero the banner hides itself — and the
// server has already closed eligibility by then.
const nowMs = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

const endsAtMs = computed(() => {
  const iso = campaign.value?.endsAt;
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
});
const msLeft = computed(() =>
  endsAtMs.value != null ? endsAtMs.value - nowMs.value : null
);
const ended = computed(() => msLeft.value != null && msLeft.value <= 0);

const countdown = computed(() => {
  if (msLeft.value == null || msLeft.value <= 0) return "";
  const total = Math.floor(msLeft.value / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}`;
});

watch(
  endsAtMs,
  (v) => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (v != null) {
      timer = setInterval(() => {
        nowMs.value = Date.now();
      }, 1000);
    }
  },
  { immediate: true }
);

// --- Campaign 2 (Lot R2): per-family rewards — the headline advertises the
// wallet's MAX take (families.length × rewardXlm), the body names both firsts.
const maxEarnXlm = computed(() => {
  const c = campaign.value;
  if (!c) return 0;
  return c.rewardXlm * (c.families?.length ?? 1);
});

// --- Claims-left progress ("54/60 left"), live from the server values.
const progressPct = computed(() => {
  const c = campaign.value;
  if (!c || c.maxClaims <= 0) return 0;
  return Math.max(0, Math.min(100, (c.remainingClaims / c.maxClaims) * 100));
});

const visible = computed(() => campaignLive.value && !!campaign.value && !ended.value);

// The CTAs reuse the dashboard's exact ActionModal contexts — the banner
// lets the user ACT, not just read.
function swapNow() {
  openAction({ slug: "sdex-swap", name: "Swap XLM ↔ USDC", venue: "Stellar DEX", kind: "amm" });
}
function supplyOnBlend() {
  openAction({ slug: "blend", name: "Blend pool", venue: "Blend", kind: "lending" });
}

onMounted(() => {
  void refreshCampaign();
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div
    v-if="visible && campaign"
    class="rounded-[18px] px-[22px] py-[18px] flex items-center justify-between gap-[18px] flex-wrap"
    style="background: var(--dig-surface); border: 1px solid rgba(213,255,47,0.35)"
  >
    <!-- Offer -->
    <div class="flex items-center gap-[14px] min-w-0">
      <BrandLogo
        variant="asset"
        :primary="XLM_LOGO"
        letter="X"
        tint="#242422"
        color="#B7B3AB"
        :size="40"
        :font-size="16"
      />
      <div class="flex flex-col gap-[4px] min-w-0">
        <div class="flex items-center gap-[8px] flex-wrap">
          <span
            class="text-[10px] font-bold uppercase tracking-widest px-[8px] py-[2px] rounded-[20px]"
            style="background: rgba(213,255,47,0.12); color: var(--dig-accent)"
          >Limited reward</span>
          <span
            v-if="campaign.network === 'testnet'"
            class="text-[10px] uppercase tracking-widest font-semibold px-[7px] py-[1px] rounded-[20px]"
            style="background: #2a2a27; color: var(--dig-faint)"
          >Testnet</span>
        </div>
        <div class="text-[20px] font-bold tracking-[-0.02em]" style="color: var(--dig-text)">
          Earn up to {{ maxEarnXlm }} XLM
        </div>
        <div class="text-[12px]" style="color: var(--dig-faint)">
          Your first swap AND your first Blend supply (each ≥
          {{ campaign.minNotionalXlm }} XLM) each earn {{ campaign.rewardXlm }} XLM.
          First-come, up to {{ campaign.families?.length ?? 2 }} rewards per wallet.
        </div>
      </div>
    </div>

    <!-- Scarcity + actions -->
    <div class="flex items-center gap-[18px] flex-wrap">
      <div class="flex flex-col gap-[6px] items-end">
        <div
          v-if="countdown"
          class="text-[12px] font-semibold tabular-nums"
          style="color: var(--dig-amber)"
          :title="`Campaign ends ${campaign.endsAt}`"
        >
          Ends in {{ countdown }}
        </div>
        <div class="text-[12px] font-semibold tabular-nums" style="color: var(--dig-text)">
          {{ campaign.remainingClaims }}/{{ campaign.maxClaims }} left
        </div>
        <div class="w-[120px] h-[4px] rounded-[4px] overflow-hidden" style="background: var(--dig-surface-3)">
          <div
            class="h-full rounded-[4px]"
            :style="{ width: progressPct + '%', background: 'var(--dig-accent)' }"
          />
        </div>
      </div>
      <div class="flex items-center gap-[10px]">
        <button
          type="button"
          class="dig-btn h-[40px] px-[18px] rounded-[12px] text-[13px] font-bold cursor-pointer"
          style="background: var(--dig-accent); color: #141414; border: none"
          @click="swapNow"
        >
          Swap now
        </button>
        <button
          type="button"
          class="dig-ghost h-[40px] px-[16px] rounded-[12px] text-[13px] font-semibold cursor-pointer"
          style="background: var(--dig-surface-3); border: 1px solid var(--dig-line); color: var(--dig-text)"
          @click="supplyOnBlend"
        >
          Supply on Blend
        </button>
      </div>
    </div>
  </div>
</template>
