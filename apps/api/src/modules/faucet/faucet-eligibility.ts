// apps/api/src/modules/faucet/faucet-eligibility.ts
//
// R2 (Lot R — T3-D2): PURE eligibility rules for the reward faucet. No I/O,
// no Nest, no env — every fact arrives as an input so the money-path review
// (and the unit specs) can exercise every branch in isolation. The service
// gathers the facts (DB + Horizon) and both the eligibility endpoint AND the
// claim path run THIS function — there is exactly one decision procedure.

export type PriorClaim = {
  status: 'pending' | 'paid' | 'failed';
  payoutTxHash: string | null;
} | null;

/**
 * The wallet's best qualifying witness (kind sdex-swap | blend-deposit on the
 * faucet network — NEVER blend-withdraw, which is KPI-ledger only):
 *   'none'      — no such witness at all
 *   'below-min' — witness exists but none meets the stored min-notional rule
 *   'ok'        — a meets_min_notional witness exists
 */
export type WitnessState = 'none' | 'below-min' | 'ok';

export type IneligibleReason =
  | 'faucet-disabled'
  | 'campaign-exhausted'
  | 'temporarily-paused'
  | 'no-qualifying-witness'
  | 'below-min-notional'
  | 'already-claimed'
  | 'claim-failed-pending-review'
  | 'treasury-unavailable'
  | 'treasury-drained';

export interface CampaignFacts {
  enabled: boolean;
  maxClaims: number;
  /**
   * Claims counted against the budget on the faucet network: pending + paid +
   * failed. Failed rows count DELIBERATELY — an ambiguous failure may still
   * have paid, so the conservative read protects the treasury; the founder
   * frees the slot by resolving the row.
   */
  countedClaims: number;
  /** Claims created in the last rolling hour on the faucet network. */
  claimsLastHour: number;
  hourlyCap: number;
}

export interface CampaignState {
  active: boolean;
  remainingClaims: number;
}

/**
 * Campaign state for the promo surface (R3): active while the flag is on and
 * budget remains. A velocity pause does NOT deactivate the campaign — it is
 * temporary by construction and surfaces as a wallet-level reason instead.
 */
export function campaignState(f: CampaignFacts): CampaignState {
  const remainingClaims = Math.max(0, f.maxClaims - f.countedClaims);
  return { active: f.enabled && remainingClaims > 0, remainingClaims };
}

export interface WalletFacts extends CampaignFacts {
  witnessState: WitnessState;
  priorClaim: PriorClaim;
  /**
   * Treasury SPENDABLE balance in XLM (native minus reserve/fee buffer), or
   * null when Horizon could not answer — null is NEVER treated as "has funds".
   */
  treasurySpendableXlm: number | null;
  rewardXlm: number;
}

export interface WalletEligibility {
  eligible: boolean;
  /** The FIRST failing condition, in check order — honest UX per the brief. */
  reason?: IneligibleReason;
}

export function walletEligibility(f: WalletFacts): WalletEligibility {
  const no = (reason: IneligibleReason): WalletEligibility => ({ eligible: false, reason });

  if (!f.enabled) return no('faucet-disabled');
  if (campaignState(f).remainingClaims <= 0) return no('campaign-exhausted');
  if (f.claimsLastHour >= f.hourlyCap) return no('temporarily-paused');
  if (f.witnessState === 'none') return no('no-qualifying-witness');
  if (f.witnessState === 'below-min') return no('below-min-notional');
  // A failed claim blocks retries until founder review (never auto-retry a
  // payment); any other existing claim is simply "already claimed".
  if (f.priorClaim?.status === 'failed') return no('claim-failed-pending-review');
  if (f.priorClaim != null) return no('already-claimed');
  if (f.treasurySpendableXlm == null) return no('treasury-unavailable');
  if (f.treasurySpendableXlm < f.rewardXlm) return no('treasury-drained');
  return { eligible: true };
}
