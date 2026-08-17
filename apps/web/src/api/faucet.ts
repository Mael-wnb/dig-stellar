// src/api/faucet.ts
//
// R3 (Lot R — T3-D2): client for the reward-faucet endpoints. Read-only
// campaign/eligibility + the one claim POST. The server re-checks everything —
// these responses are advisory for rendering, never trusted for money logic.
import { apiFetch } from "./client";

export type FaucetCampaign = {
  active: boolean;
  remainingClaims: number;
  /** Campaign budget — for the "34/40 left" progress (R3b). */
  maxClaims: number;
  rewardXlm: number;
  network: "testnet" | "mainnet";
  minNotionalXlm: number;
  /** ISO deadline or null (R3b). Server-enforced; countdown-only client-side. */
  endsAt: string | null;
};

export type FaucetIneligibleReason =
  | "faucet-disabled"
  | "campaign-ended"
  | "campaign-exhausted"
  | "temporarily-paused"
  | "no-qualifying-witness"
  | "below-min-notional"
  | "already-claimed"
  | "claim-failed-pending-review"
  | "treasury-unavailable"
  | "treasury-drained";

export type FaucetEligibility = {
  campaign: FaucetCampaign;
  wallet?: {
    address: string;
    eligible: boolean;
    reason?: FaucetIneligibleReason;
    claim?: { status: string; payoutTxHash: string | null };
  };
};

export type FaucetClaimResult =
  | { claimed: true; status: "paid"; payoutTxHash: string; rewardXlm: number }
  | { claimed: false; status?: "failed"; reason: FaucetIneligibleReason | "payout-failed" | "claim-error" };

export async function fetchFaucetEligibility(
  wallet?: string
): Promise<FaucetEligibility> {
  const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
  return apiFetch<FaucetEligibility>(`/faucet/eligibility${qs}`);
}

export async function claimFaucetReward(
  wallet: string
): Promise<FaucetClaimResult> {
  return apiFetch<FaucetClaimResult>("/faucet/claim", {
    method: "POST",
    body: JSON.stringify({ wallet }),
  });
}
