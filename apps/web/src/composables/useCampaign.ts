// apps/web/src/composables/useCampaign.ts
//
// Lot EP (EP2): shared Earn & Points state — the useFaucet shape. ONE module
// singleton: the public campaign state (GET /campaign) refreshed at most once a
// minute, the connected wallet's /me, and the write actions. The campaign is
// `active` only when the API says so; a fetch failure leaves it null (unknown)
// and every Earn surface hides — the promo must never be a stale promise.
//
// Nothing here computes points, streaks or multipliers (ai-guidelines layer
// rule): every number rendered comes from the API payloads below, and the
// API's `disclaimer` string is exposed so each surface renders it.
//
// EP5: XLM rewards state (GET /campaign/rewards/me, refreshed with /me; claim
// through POST /campaign/rewards/claim — the API decides and pays, the web
// renders the result), the immediate per-wallet award (POST /campaign/sync,
// item 8) and the witness OUTBOX (lib/witnessOutbox, item 9): every submitted
// tx hash is kept in localStorage and re-reported until the API acknowledges
// it, on Earn view load and after each action, then /sync runs. `verifying`
// counts the hashes being (re)reported so the hero can say so.
//
// Enrol flow: connect (elsewhere) → signProof(address, userId) → POST /enroll.
// The proof is a signed TEXT message, not a transaction (no XDR exists); the
// EnrollCard says so before the wallet prompt. A wallet whose Kit module has no
// signMessage (Lobstr today) gets WALLET_CANNOT_SIGN_MESSAGE.
import { computed, ref } from "vue";
import {
  checkinCampaign,
  claimRewards as claimRewardsApi,
  claimSocialTask,
  deleteSocialClaim,
  enrollCampaign,
  fetchCampaign,
  fetchCampaignActivity,
  fetchCampaignLeaderboard,
  fetchCampaignMe,
  fetchRewardsMe,
  syncCampaign,
  type ActionKind,
  type CampaignActivity,
  type CampaignLeaderboard,
  type CampaignMe,
  type CampaignState,
  type CampaignSyncResult,
  type CheckinResult,
  type EnrollResult,
  type RewardsClaimResult,
  type RewardsMe,
  type SocialClaimResult,
  type SocialDeleteResult,
  type SocialTaskKey,
} from "../api/campaign";
import { isWitnessSettled, reportActionWitness, submitActionWitness } from "../api/actions";
import { acknowledgeInOutbox, addToOutbox, pruneOutbox, type OutboxKind, type OutboxNetwork } from "../lib/witnessOutbox";
import { pointsForActionIn } from "../lib/pointsForAction";
import { track } from "../lib/analytics";
import { useAppUser } from "./useAppUser";
import { signProof, useWalletSession } from "./useWalletSession";
import { useView } from "./useView";

export const WALLET_CANNOT_SIGN_MESSAGE =
  "This wallet cannot sign messages; use Freighter or xBull to join.";

/** Kit modules without signMessage in 1.9.5 (ep1-wallet-matrix.md §3). */
const PROVIDERS_WITHOUT_MESSAGE_SIGNING: ReadonlySet<string> = new Set(["lobstr"]);

const campaign = ref<CampaignState | null>(null);
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const REFRESH_MS = 60_000;

const me = ref<CampaignMe | null>(null);
const meLoading = ref(false);
const leaderboard = ref<CampaignLeaderboard | null>(null);
/** EP4: the connected wallet's last ledger rows (GET /campaign/me/activity); refreshed with /me. */
const activity = ref<CampaignActivity | null>(null);
/** EP5: the connected wallet's XLM rewards (GET /campaign/rewards/me); null while disabled / unknown. */
const rewards = ref<RewardsMe | null>(null);
/** EP5 item 9: tx hashes currently being (re)reported — the hero shows "Verifying N recent actions…". */
const verifying = ref(0);
let flushing: Promise<void> | null = null;

async function refreshCampaign(force = false): Promise<void> {
  const now = Date.now();
  if (!force && campaign.value !== null && now - loadedAt < REFRESH_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      campaign.value = await fetchCampaign();
      loadedAt = Date.now();
    } catch {
      campaign.value = null; // unknown = hidden, never a stale promise
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}


export function useCampaign() {
  const { connectedAddress, connectedProvider } = useWalletSession();
  const { userId } = useAppUser();
  const { pendingReferralCode } = useView();

  const active = computed(() => !!campaign.value?.active);
  const rules = computed(() => campaign.value?.rules ?? null);
  /** EP5: the whole XLM surface is gated on this one API boolean (absent on an older API = disabled). */
  const rewardsEnabled = computed(() => campaign.value?.rules.rewards?.enabled === true);
  /** EP3: gating flags straight from /me (derived by the API from granted perks). Nothing is gated yet. */
  const flags = computed(() => me.value?.flags ?? { beta: false });
  const disclaimer = computed(() => campaign.value?.disclaimer ?? me.value?.disclaimer ?? null);

  /** Both halves the campaign writes need: the connected signer AND the app user. */
  const identity = computed(() =>
    connectedAddress.value && userId.value ? { address: connectedAddress.value, userId: userId.value } : null,
  );

  const walletCanSignMessages = computed(
    () => !connectedProvider.value || !PROVIDERS_WITHOUT_MESSAGE_SIGNING.has(connectedProvider.value),
  );

  function pointsForAction(kind: ActionKind): number | null {
    return pointsForActionIn(campaign.value, kind);
  }

  async function refreshActivity(): Promise<void> {
    const id = identity.value;
    if (!id) {
      activity.value = null;
      return;
    }
    try {
      activity.value = await fetchCampaignActivity(id.address, id.userId);
    } catch {
      activity.value = null;
    }
  }

  async function refreshRewards(): Promise<void> {
    const id = identity.value;
    if (!id || !rewardsEnabled.value) {
      rewards.value = null;
      return;
    }
    try {
      rewards.value = await fetchRewardsMe(id.address, id.userId);
    } catch {
      rewards.value = null;
    }
  }

  async function refreshMe(): Promise<void> {
    const id = identity.value;
    if (!id) {
      me.value = null;
      activity.value = null;
      rewards.value = null;
      return;
    }
    meLoading.value = true;
    try {
      me.value = await fetchCampaignMe(id.address, id.userId);
    } catch {
      me.value = null;
    } finally {
      meLoading.value = false;
    }
    // EP4: every write path calls refreshMe, so the feed follows the balance.
    await refreshActivity();
    // EP5: and the claimable XLM follows the ledger.
    await refreshRewards();
  }

  /**
   * EP5 item 8: POST /campaign/sync — ask the API to award this wallet's
   * verified actions now (the cron job stays the safety net). Null when the
   * campaign is inactive, nobody is connected, or the call failed.
   */
  async function sync(): Promise<CampaignSyncResult | null> {
    const id = identity.value;
    if (!id || !active.value) return null;
    try {
      return await syncCampaign(id);
    } catch {
      return null;
    }
  }

  /**
   * EP5 item 9: re-POST every outbox hash the API has not acknowledged yet
   * (younger than 24 h), drop acknowledged / expired entries, then /sync and
   * refresh /me. Runs on Earn view load and after each action; concurrent
   * callers share one run.
   */
  async function flushOutboxAndSync(): Promise<void> {
    if (flushing) return flushing;
    flushing = (async () => {
      const pending = pruneOutbox();
      if (pending.length > 0) {
        verifying.value += pending.length;
        try {
          await Promise.all(
            pending.map(async (e) => {
              const res = await submitActionWitness({ txHash: e.txHash, network: e.network, userId: userId.value ?? undefined }).catch(() => null);
              if (isWitnessSettled(res)) acknowledgeInOutbox(e.txHash);
            }),
          );
        } finally {
          verifying.value = Math.max(0, verifying.value - pending.length);
        }
        pruneOutbox();
      }
      if (identity.value && active.value) {
        await sync();
        await refreshMe();
      }
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  /**
   * EP5 item 9: what the swap / Blend widgets call right after a successful
   * submit (instead of the bare fire-and-forget report): record the hash in the
   * outbox FIRST (so a closed tab cannot lose it), report it with the usual
   * retries, acknowledge on a definitive answer, then flush + sync + refresh.
   * Never throws: the action flow must not depend on it.
   */
  async function witnessAndSync(tx: { txHash: string; network: OutboxNetwork; kind: OutboxKind }): Promise<void> {
    addToOutbox(tx);
    verifying.value += 1;
    try {
      const res = await reportActionWitness({ txHash: tx.txHash, network: tx.network, userId: userId.value ?? undefined });
      if (isWitnessSettled(res)) acknowledgeInOutbox(tx.txHash);
    } catch {
      // reportActionWitness never throws; belt and braces
    } finally {
      verifying.value = Math.max(0, verifying.value - 1);
    }
    await flushOutboxAndSync();
  }

  /** EP5: POST /campaign/rewards/claim — the API decides, pays ONE transaction and answers; the web renders. */
  async function claimRewards(): Promise<RewardsClaimResult> {
    const id = identity.value;
    if (!id) throw new Error("Connect a wallet first.");
    const res = await claimRewardsApi(id);
    if (res.claimed) track("rewards_claim"); // Lot AN0: no parameters at all
    await refreshMe();
    return res;
  }

  async function refreshLeaderboard(): Promise<void> {
    try {
      leaderboard.value = await fetchCampaignLeaderboard(connectedAddress.value);
    } catch {
      leaderboard.value = null;
    }
  }

  /**
   * Prove ownership (signed text, NOT a transaction) then enrol. The referral
   * code (if any) comes from the #earn?ref=CODE hash held in memory by useView.
   */
  async function enroll(): Promise<EnrollResult> {
    const id = identity.value;
    if (!id) throw new Error("Connect a wallet first.");
    if (!walletCanSignMessages.value) throw new Error(WALLET_CANNOT_SIGN_MESSAGE);

    let proven = false;
    try {
      proven = (await signProof(id.address, id.userId)).result.ok;
    } catch (err) {
      // A missing signMessage surfaces as a Kit error; the API never saw a proof.
      console.error("[campaign] proof failed", err);
      throw new Error(WALLET_CANNOT_SIGN_MESSAGE);
    }
    if (!proven) throw new Error("The wallet signature could not be verified. Please try again.");

    const res = await enrollCampaign({ ...id, referralCode: pendingReferralCode.value });
    if (res.enrolled) {
      pendingReferralCode.value = null; // used once, never stored
      track("campaign_enroll"); // Lot AN0: no parameters at all
    }
    await refreshMe();
    return res;
  }

  async function checkin(): Promise<CheckinResult> {
    const id = identity.value;
    if (!id) throw new Error("Connect a wallet first.");
    const res = await checkinCampaign(id);
    if (res.checkedIn) track("campaign_checkin"); // Lot AN0: no parameters at all
    await refreshMe();
    return res;
  }

  async function claimSocial(task: SocialTaskKey, handle: string): Promise<SocialClaimResult> {
    const id = identity.value;
    if (!id) throw new Error("Connect a wallet first.");
    const res = await claimSocialTask({ ...id, task, handle });
    await refreshMe();
    return res;
  }

  async function removeSocial(claimId: string): Promise<SocialDeleteResult> {
    const id = identity.value;
    if (!id) throw new Error("Connect a wallet first.");
    const res = await deleteSocialClaim(claimId, id);
    await refreshMe();
    return res;
  }

  return {
    campaign,
    active,
    rules,
    flags,
    disclaimer,
    me,
    meLoading,
    leaderboard,
    activity,
    rewards,
    rewardsEnabled,
    verifying,
    identity,
    walletCanSignMessages,
    pendingReferralCode,
    pointsForAction,
    refreshCampaign,
    refreshMe,
    refreshActivity,
    refreshRewards,
    refreshLeaderboard,
    sync,
    flushOutboxAndSync,
    witnessAndSync,
    claimRewards,
    enroll,
    checkin,
    claimSocial,
    removeSocial,
  };
}
