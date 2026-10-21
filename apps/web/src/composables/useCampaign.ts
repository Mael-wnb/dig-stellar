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
// Enrol flow: connect (elsewhere) → signProof(address, userId) → POST /enroll.
// The proof is a signed TEXT message, not a transaction (no XDR exists); the
// EnrollCard says so before the wallet prompt. A wallet whose Kit module has no
// signMessage (Lobstr today) gets WALLET_CANNOT_SIGN_MESSAGE.
import { computed, ref } from "vue";
import {
  checkinCampaign,
  claimSocialTask,
  deleteSocialClaim,
  enrollCampaign,
  fetchCampaign,
  fetchCampaignLeaderboard,
  fetchCampaignMe,
  type ActionKind,
  type CampaignLeaderboard,
  type CampaignMe,
  type CampaignState,
  type CheckinResult,
  type EnrollResult,
  type SocialClaimResult,
  type SocialDeleteResult,
  type SocialTaskKey,
} from "../api/campaign";
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

  async function refreshMe(): Promise<void> {
    const id = identity.value;
    if (!id) {
      me.value = null;
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
    identity,
    walletCanSignMessages,
    pendingReferralCode,
    pointsForAction,
    refreshCampaign,
    refreshMe,
    refreshLeaderboard,
    enroll,
    checkin,
    claimSocial,
    removeSocial,
  };
}
