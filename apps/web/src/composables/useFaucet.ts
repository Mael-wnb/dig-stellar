// src/composables/useFaucet.ts
//
// R3 (Lot R — T3-D2): shared campaign state for every promo surface. One
// module-level fetch (refreshed at most once a minute, forceable after a
// claim) so the dashboard banner and both widget notes agree. A fetch failure
// leaves the campaign null and every surface hidden — the promo must never be
// a stale promise (Lot R rule), so "unknown" renders as "no campaign".
import { computed, ref } from "vue";
import { fetchFaucetEligibility, type FaucetCampaign } from "../api/faucet";

const campaign = ref<FaucetCampaign | null>(null);
let loadedAt = 0;
let inflight: Promise<void> | null = null;

const REFRESH_MS = 60_000;

async function refreshCampaign(force = false): Promise<void> {
  const now = Date.now();
  if (!force && campaign.value !== null && now - loadedAt < REFRESH_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetchFaucetEligibility();
      campaign.value = res.campaign;
      loadedAt = Date.now();
    } catch {
      campaign.value = null; // unknown = hidden, never a stale promise
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useFaucet() {
  // Live = flag on AND budget remaining (the server computes both). Surfaces
  // additionally pin the network so a testnet campaign never promises on a
  // mainnet surface and vice versa.
  const campaignLive = computed(
    () => !!campaign.value?.active && (campaign.value?.remainingClaims ?? 0) > 0
  );

  function campaignLiveFor(network: "testnet" | "mainnet"): boolean {
    return campaignLive.value && campaign.value?.network === network;
  }

  return { campaign, campaignLive, campaignLiveFor, refreshCampaign };
}
