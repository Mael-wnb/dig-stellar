// src/api/faucet.ts
//
// R3 (Lot R — T3-D2) / campaign 2 (Lot R2): client for the reward-faucet
// endpoints. Read-only campaign/eligibility + the one claim POST. Campaign 2
// is PER FAMILY: first verified swap AND first verified Blend supply each
// earn the reward, so eligibility and claims name the family. The server
// re-checks everything — these responses are advisory for rendering, never
// trusted for money logic.
import { apiFetch } from "./client";

export type FaucetActionFamily = "swap" | "blend-supply";

export type FaucetCampaign = {
  /** Which campaign the server is running (2 = per-family rewards). */
  campaign: number;
  active: boolean;
  remainingClaims: number;
  /** Campaign budget — for the "54/60 left" progress (R3b). */
  maxClaims: number;
  rewardXlm: number;
  /** Rewardable families — "up to families.length × rewardXlm" per wallet. */
  families: FaucetActionFamily[];
  network: "testnet" | "mainnet";
  minNotionalXlm: number;
  /** ISO deadline or null (R3b). Server-enforced; countdown-only client-side. */
  endsAt: string | null;
};

export type FaucetIneligibleReason =
  | "faucet-disabled"
  | "campaign-not-started"
  | "campaign-ended"
  | "campaign-exhausted"
  | "temporarily-paused"
  | "no-qualifying-witness"
  | "below-min-notional"
  | "already-claimed"
  | "claim-failed-pending-review"
  | "treasury-unavailable"
  | "treasury-drained";

export type FaucetFamilyStatus = {
  eligible: boolean;
  reason?: FaucetIneligibleReason;
  claim?: { status: string; payoutTxHash: string | null };
};

export type FaucetEligibility = {
  campaign: FaucetCampaign;
  wallet?: {
    address: string;
    families: Record<FaucetActionFamily, FaucetFamilyStatus>;
  };
};

export type FaucetClaimResult =
  | { claimed: true; status: "paid"; payoutTxHash: string; rewardXlm: number }
  | { claimed: false; status?: "failed"; reason: FaucetIneligibleReason | "payout-failed" | "claim-error" };

export async function fetchFaucetEligibility(
  wallet?: string
): Promise<FaucetEligibility> {
  const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
  // R3c: a POLLED endpoint must never be served from cache (prod showed 304s
  // freezing the panel). Belt-and-braces with the API's Cache-Control: no-store.
  return apiFetch<FaucetEligibility>(`/faucet/eligibility${qs}`, {
    cache: "no-store",
  });
}

export async function claimFaucetReward(
  wallet: string,
  family: FaucetActionFamily
): Promise<FaucetClaimResult> {
  return apiFetch<FaucetClaimResult>("/faucet/claim", {
    method: "POST",
    body: JSON.stringify({ wallet, family }),
  });
}
