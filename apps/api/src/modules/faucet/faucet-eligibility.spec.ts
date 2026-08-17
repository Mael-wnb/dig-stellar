// R2 (Lot R — T3-D2): specs for the PURE faucet eligibility rules — the unit
// half of the R4 red tests (double claim, disabled flag, below-notional,
// exhausted budget, velocity brake, drained treasury).
import {
  campaignState,
  walletEligibility,
  type WalletFacts,
} from './faucet-eligibility';

/** A fully-eligible baseline; each test flips exactly one fact. */
const eligibleFacts = (): WalletFacts => ({
  enabled: true,
  maxClaims: 40,
  countedClaims: 5,
  claimsLastHour: 2,
  hourlyCap: 10,
  witnessState: 'ok',
  priorClaim: null,
  treasurySpendableXlm: 150,
  rewardXlm: 5,
});

describe('campaignState', () => {
  it('is active with the flag on and budget remaining', () => {
    expect(campaignState(eligibleFacts())).toEqual({ active: true, remainingClaims: 35 });
  });

  it('deactivates when the flag is off (dark deploy) or the budget is spent', () => {
    expect(campaignState({ ...eligibleFacts(), enabled: false }).active).toBe(false);
    expect(campaignState({ ...eligibleFacts(), countedClaims: 40 })).toEqual({
      active: false,
      remainingClaims: 0,
    });
  });

  it('never reports negative remaining claims', () => {
    expect(campaignState({ ...eligibleFacts(), countedClaims: 45 }).remainingClaims).toBe(0);
  });

  it('stays active under a velocity pause (temporary, wallet-level only)', () => {
    expect(campaignState({ ...eligibleFacts(), claimsLastHour: 10 }).active).toBe(true);
  });
});

describe('walletEligibility', () => {
  it('is eligible on the baseline facts', () => {
    expect(walletEligibility(eligibleFacts())).toEqual({ eligible: true });
  });

  const cases: Array<[string, Partial<WalletFacts>, string]> = [
    ['disabled flag', { enabled: false }, 'faucet-disabled'],
    ['exhausted budget', { countedClaims: 40 }, 'campaign-exhausted'],
    ['velocity brake at the cap', { claimsLastHour: 10 }, 'temporarily-paused'],
    ['no witness', { witnessState: 'none' }, 'no-qualifying-witness'],
    ['below min notional', { witnessState: 'below-min' }, 'below-min-notional'],
    [
      'prior paid claim (double claim)',
      { priorClaim: { status: 'paid', payoutTxHash: 'abc' } },
      'already-claimed',
    ],
    [
      'prior pending claim',
      { priorClaim: { status: 'pending', payoutTxHash: null } },
      'already-claimed',
    ],
    [
      'prior FAILED claim blocks until founder review',
      { priorClaim: { status: 'failed', payoutTxHash: null } },
      'claim-failed-pending-review',
    ],
    ['treasury unknown (Horizon down / no key)', { treasurySpendableXlm: null }, 'treasury-unavailable'],
    ['drained treasury (spendable < reward)', { treasurySpendableXlm: 4.9 }, 'treasury-drained'],
  ];

  it.each(cases)('rejects on %s', (_label, override, reason) => {
    expect(walletEligibility({ ...eligibleFacts(), ...override })).toEqual({
      eligible: false,
      reason,
    });
  });

  it('reports the FIRST failing condition when several fail (disabled beats no-witness)', () => {
    const r = walletEligibility({ ...eligibleFacts(), enabled: false, witnessState: 'none' });
    expect(r.reason).toBe('faucet-disabled');
  });

  it('treasury exactly at the reward amount still pays (>= rule)', () => {
    expect(walletEligibility({ ...eligibleFacts(), treasurySpendableXlm: 5 }).eligible).toBe(true);
  });
});
