<script setup lang="ts">
// R3 (Lot R — T3-D2): the post-action claim flow, mounted inside the widgets'
// success (and Blend pending) states. Renders NOTHING while the campaign is
// dark for this network — no promise, no dead button. Otherwise it polls
// eligibility while the witness lands server-side (the fire-and-forget report
// takes a few ledgers + retries), then offers ONE claim click; every
// ineligible state renders its honest reason. Never blocks or delays the
// action flow it sits under — it is purely additive UI.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  claimFaucetReward,
  fetchFaucetEligibility,
  type FaucetIneligibleReason,
} from "../api/faucet";
import { useFaucet } from "../composables/useFaucet";

const props = defineProps<{
  /** The acting wallet — the payout always goes to this exact address. */
  wallet: string;
  network: "testnet" | "mainnet";
}>();

const { campaign, campaignLiveFor, refreshCampaign } = useFaucet();

type PanelState =
  | "hidden" // campaign dark for this network — render nothing
  | "checking" // witness still landing server-side
  | "eligible"
  | "claiming"
  | "paid"
  | "ineligible";

const state = ref<PanelState>("hidden");
const reason = ref<FaucetIneligibleReason | "payout-failed" | "claim-error" | null>(null);
const payoutTxHash = ref("");
const rewardXlm = computed(() => campaign.value?.rewardXlm ?? 5);

const explorerNetwork = computed(() => (props.network === "mainnet" ? "public" : "testnet"));

// The witness lands within ~25s of submit (client retries) — poll a little
// longer than that, then stop with an honest "not verified yet" (the reward
// stays claimable later; re-opening the widget re-checks).
const POLL_MS = 5000;
const MAX_POLLS = 8;
let polls = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let disposed = false;

const REASON_COPY: Record<string, string> = {
  "no-qualifying-witness":
    "We couldn't verify this action yet — your reward stays claimable, check back shortly.",
  "below-min-notional": "", // filled at render (needs the live min)
  "already-claimed": "Reward already claimed — one per wallet, ever.",
  "claim-failed-pending-review":
    "A previous claim needs manual review — no action needed on your side.",
  "temporarily-paused": "Rewards are temporarily paused (hourly limit) — try again within the hour.",
  "campaign-exhausted": "All rewards have been claimed — the campaign is over.",
  "treasury-drained": "Rewards are paused while the reward pool refills.",
  "treasury-unavailable": "Rewards are momentarily unavailable — try again shortly.",
  "payout-failed":
    "Your claim was recorded but the payout hit an error — it will be resolved manually, nothing else to do.",
  "claim-error": "Something went wrong recording the claim — try again shortly.",
};

const reasonCopy = computed(() => {
  if (reason.value === "below-min-notional") {
    return `This action was below the ${campaign.value?.minNotionalXlm ?? 1} XLM minimum — a larger swap or supply qualifies.`;
  }
  return reason.value ? (REASON_COPY[reason.value] ?? "Not eligible for a reward.") : "";
});

async function checkEligibility(): Promise<void> {
  if (disposed) return;
  try {
    const res = await fetchFaucetEligibility(props.wallet);
    if (disposed) return;
    campaign.value = res.campaign;
    const w = res.wallet;
    if (!w) return;
    if (w.eligible) {
      state.value = "eligible";
      return;
    }
    // A paid prior claim renders as the paid state (payout link), not a reason.
    if (w.reason === "already-claimed" && w.claim?.status === "paid" && w.claim.payoutTxHash) {
      payoutTxHash.value = w.claim.payoutTxHash;
      state.value = "paid";
      return;
    }
    if (w.reason === "faucet-disabled") {
      state.value = "hidden";
      return;
    }
    if (w.reason === "no-qualifying-witness" && polls < MAX_POLLS) {
      // Witness likely still landing — keep quietly checking.
      state.value = "checking";
      polls += 1;
      timer = setTimeout(() => void checkEligibility(), POLL_MS);
      return;
    }
    reason.value = w.reason ?? null;
    state.value = "ineligible";
  } catch {
    if (!disposed && polls < MAX_POLLS) {
      polls += 1;
      timer = setTimeout(() => void checkEligibility(), POLL_MS);
    }
  }
}

async function onClaim(): Promise<void> {
  if (state.value !== "eligible") return;
  state.value = "claiming";
  try {
    const res = await claimFaucetReward(props.wallet);
    if (res.claimed) {
      payoutTxHash.value = res.payoutTxHash;
      state.value = "paid";
    } else {
      reason.value = res.reason;
      state.value = "ineligible";
    }
  } catch {
    reason.value = "claim-error";
    state.value = "ineligible";
  } finally {
    void refreshCampaign(true); // remainingClaims moved (or the flag flipped)
  }
}

onMounted(async () => {
  await refreshCampaign();
  if (!campaignLiveFor(props.network)) return; // stays hidden — no promise made
  state.value = "checking";
  void checkEligibility();
});

onBeforeUnmount(() => {
  disposed = true;
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <div
    v-if="state !== 'hidden'"
    class="rounded-[12px] px-[14px] py-[11px] text-[12px] flex flex-col gap-[4px]"
    style="background: var(--dig-surface-2); border: 1px solid rgba(213,255,47,0.35)"
  >
    <template v-if="state === 'checking'">
      <span style="color: var(--dig-faint)">Checking reward eligibility…</span>
    </template>

    <template v-else-if="state === 'eligible'">
      <span class="font-semibold" style="color: var(--dig-accent)">
        Your action qualifies — claim {{ rewardXlm }} XLM
      </span>
      <button
        type="button"
        class="dig-btn w-fit mt-[4px] px-[16px] h-[34px] rounded-[10px] text-[12px] font-bold cursor-pointer"
        style="background: var(--dig-accent); color: #141414; border: none"
        @click="onClaim"
      >
        Claim {{ rewardXlm }} XLM
      </button>
    </template>

    <template v-else-if="state === 'claiming'">
      <span style="color: var(--dig-faint)">Claiming your {{ rewardXlm }} XLM…</span>
    </template>

    <template v-else-if="state === 'paid'">
      <span class="font-semibold" style="color: var(--dig-accent)">
        {{ rewardXlm }} XLM reward paid 🎉
      </span>
      <a
        :href="`https://stellar.expert/explorer/${explorerNetwork}/tx/${payoutTxHash}`"
        target="_blank"
        rel="noopener"
        class="hover:underline w-fit"
        style="color: var(--dig-faint)"
      >
        View payout on stellar.expert ↗
      </a>
    </template>

    <template v-else>
      <span style="color: var(--dig-faint)">{{ reasonCopy }}</span>
    </template>
  </div>
</template>
