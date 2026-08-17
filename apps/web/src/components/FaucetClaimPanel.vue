<script setup lang="ts">
// R3 (Lot R) / R3c fixes: the post-action claim flow, mounted INSIDE the
// widgets' success/pending blocks. Renders NOTHING while the campaign is dark
// for this network — no promise, no dead button.
//
// Verification is WITNESS-FIRST (R3c): the panel re-POSTs the tx hash to the
// idempotent witness endpoint, so a witness failure surfaces its HONEST
// server reason (no-matching-build, no-qualifying-op, …) instead of polling
// eligibility forever. The polling phase is hard-capped (~60s) and every
// terminal state offers a Retry — an infinite spinner is impossible by
// construction. 429s from the edge rate limiter back off with honest
// "retrying" copy. Never blocks or delays the action flow it sits under.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { claimFaucetReward, fetchFaucetEligibility } from "../api/faucet";
import { submitActionWitness } from "../api/actions";
import { ApiError } from "../api/client";
import { useAppUser } from "../composables/useAppUser";
import { useFaucet } from "../composables/useFaucet";

const props = defineProps<{
  /** The acting wallet — the payout always goes to this exact address. */
  wallet: string;
  network: "testnet" | "mainnet";
  /** The executed tx — re-witnessed idempotently to verify eligibility. */
  txHash: string;
}>();

const { campaign, campaignLiveFor, refreshCampaign } = useFaucet();
const { userId } = useAppUser();

type PanelState =
  | "hidden" // campaign dark for this network — render nothing
  | "checking" // witness/eligibility verification in progress
  | "witness-failed" // honest terminal witness reason — with Retry
  | "eligible"
  | "claiming"
  | "paid"
  | "ineligible";

const state = ref<PanelState>("hidden");
const reason = ref<string | null>(null);
const payoutTxHash = ref("");
/** True while a 429 backoff is in progress — drives the honest retry copy. */
const rateLimited = ref(false);
const rewardXlm = computed(() => campaign.value?.rewardXlm ?? 5);

const explorerNetwork = computed(() => (props.network === "mainnet" ? "public" : "testnet"));

// Polling: 5s steps, 10s after a 429, hard cap ~60s of trying — then an
// honest terminal state with Retry. The tx usually confirms within seconds.
const POLL_MS = 5000;
const RATE_LIMIT_BACKOFF_MS = 10_000;
const POLL_BUDGET_MS = 60_000;
/** Witness reasons that just mean "not settled yet" — worth another poll. */
const WITNESS_RETRYABLE = new Set(["tx-not-found", "tx-not-successful"]);

let startedAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let disposed = false;

const WITNESS_REASON_COPY: Record<string, string> = {
  "no-matching-build":
    "We couldn't link this transaction to an action built in Dig — rewards only apply to in-app actions.",
  "unknown-wallet": "This wallet isn't registered in Dig, so the action can't be verified.",
  "no-qualifying-op": "This transaction doesn't contain a qualifying swap or supply.",
  "tx-not-found": "The transaction isn't visible on the network yet.",
  "tx-not-successful": "The transaction isn't confirmed on the network yet.",
  timeout: "We couldn't verify this action yet — the network may be slow.",
  unreachable: "We couldn't reach the server to verify this action.",
};

const ELIGIBILITY_REASON_COPY: Record<string, string> = {
  "below-min-notional": "", // filled at render (needs the live min)
  "already-claimed": "Reward already claimed — one per wallet, ever.",
  "claim-failed-pending-review":
    "A previous claim needs manual review — no action needed on your side.",
  "temporarily-paused": "Rewards are temporarily paused (hourly limit) — try again within the hour.",
  "campaign-ended": "The reward campaign has ended.",
  "campaign-exhausted": "All rewards have been claimed — the campaign is over.",
  "treasury-drained": "Rewards are paused while the reward pool refills.",
  "treasury-unavailable": "Rewards are momentarily unavailable — try again shortly.",
  "payout-failed":
    "Your claim was recorded but the payout hit an error — it will be resolved manually, nothing else to do.",
  "claim-error": "Something went wrong recording the claim — try again shortly.",
};

const reasonCopy = computed(() => {
  if (!reason.value) return "";
  if (reason.value === "below-min-notional") {
    return `This action was below the ${campaign.value?.minNotionalXlm ?? 1} XLM minimum — a larger swap or supply qualifies.`;
  }
  return (
    WITNESS_REASON_COPY[reason.value] ??
    ELIGIBILITY_REASON_COPY[reason.value] ??
    "Not eligible for a reward."
  );
});

function schedule(fn: () => void, ms: number): void {
  timer = setTimeout(fn, ms);
}

function witnessFailed(r: string): void {
  reason.value = r;
  state.value = "witness-failed";
  rateLimited.value = false;
}

/** One verification step: witness first, then (once witnessed) eligibility. */
async function step(): Promise<void> {
  if (disposed) return;
  const elapsed = Date.now() - startedAt;
  rateLimited.value = false;

  let witnessed: boolean;
  let wReason: string | undefined;
  try {
    const w = await submitActionWitness({
      txHash: props.txHash,
      network: props.network,
      userId: userId.value ?? undefined,
    });
    witnessed = w.witnessed;
    wReason = w.reason;
  } catch (err) {
    if (disposed) return;
    if (err instanceof ApiError && err.status === 429) {
      // Edge rate limit — honest copy, longer backoff, still budget-capped.
      if (elapsed < POLL_BUDGET_MS) {
        rateLimited.value = true;
        schedule(() => void step(), RATE_LIMIT_BACKOFF_MS);
        return;
      }
      witnessFailed("unreachable");
      return;
    }
    if (elapsed < POLL_BUDGET_MS) {
      schedule(() => void step(), POLL_MS);
      return;
    }
    witnessFailed("unreachable");
    return;
  }
  if (disposed) return;

  if (!witnessed) {
    // HONEST surface (R3c): a terminal witness reason ends the flow with its
    // copy + Retry; only "not settled yet" keeps polling, within the budget.
    if (wReason && WITNESS_RETRYABLE.has(wReason) && elapsed < POLL_BUDGET_MS) {
      schedule(() => void step(), POLL_MS);
      return;
    }
    witnessFailed(wReason ?? "timeout");
    return;
  }

  await checkEligibility(elapsed);
}

async function checkEligibility(elapsed: number): Promise<void> {
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
    if (w.reason === "already-claimed" && w.claim?.status === "paid" && w.claim.payoutTxHash) {
      payoutTxHash.value = w.claim.payoutTxHash;
      state.value = "paid";
      return;
    }
    if (w.reason === "faucet-disabled") {
      state.value = "hidden";
      return;
    }
    reason.value = w.reason ?? null;
    state.value = "ineligible";
  } catch (err) {
    if (disposed) return;
    if (err instanceof ApiError && err.status === 429 && elapsed < POLL_BUDGET_MS) {
      rateLimited.value = true;
      schedule(() => void step(), RATE_LIMIT_BACKOFF_MS);
      return;
    }
    if (elapsed < POLL_BUDGET_MS) {
      schedule(() => void step(), POLL_MS);
      return;
    }
    witnessFailed("unreachable");
  }
}

/** Retry from any terminal state — resets the polling budget. */
function retry(): void {
  if (timer) clearTimeout(timer);
  reason.value = null;
  startedAt = Date.now();
  state.value = "checking";
  void step();
}

async function onClaim(): Promise<void> {
  if (state.value !== "eligible") return;
  state.value = "claiming";
  rateLimited.value = false;
  // The claim POST sits in the strict rate-limit zone: retry a bounded number
  // of times on 429 (the edge rejected it BEFORE the API — resubmitting is
  // safe), with honest copy while waiting.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await claimFaucetReward(props.wallet);
      if (disposed) return;
      rateLimited.value = false;
      if (res.claimed) {
        payoutTxHash.value = res.payoutTxHash;
        state.value = "paid";
      } else {
        reason.value = res.reason;
        state.value = "ineligible";
      }
      void refreshCampaign(true); // remainingClaims moved (or the flag flipped)
      return;
    } catch (err) {
      if (disposed) return;
      if (err instanceof ApiError && err.status === 429 && attempt < 2) {
        rateLimited.value = true;
        await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
        continue;
      }
      reason.value = "claim-error";
      state.value = "ineligible";
      void refreshCampaign(true);
      return;
    }
  }
}

onMounted(async () => {
  await refreshCampaign();
  if (disposed || !campaignLiveFor(props.network)) return; // stays hidden — no promise made
  startedAt = Date.now();
  state.value = "checking";
  void step();
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
      <span style="color: var(--dig-faint)">
        {{ rateLimited ? "Rate-limited — retrying…" : "Checking reward eligibility…" }}
      </span>
    </template>

    <template v-else-if="state === 'witness-failed'">
      <span style="color: var(--dig-faint)">{{ reasonCopy }}</span>
      <button
        type="button"
        class="w-fit mt-[2px] cursor-pointer hover:underline font-semibold"
        style="color: var(--dig-accent)"
        @click="retry"
      >
        Check again
      </button>
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
      <span style="color: var(--dig-faint)">
        {{ rateLimited ? "Rate-limited — retrying your claim…" : `Claiming your ${rewardXlm} XLM…` }}
      </span>
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
