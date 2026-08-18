// R2 (Lot R — T3-D2): specs for the PURE faucet eligibility rules — the unit
// half of the R4 red tests (double claim, disabled flag, below-notional,
// exhausted budget, velocity brake, drained treasury).
import {
  campaignState,
  walletEligibility,
  type WalletFacts,
} from './faucet-eligibility';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

/**
 * A fully-eligible baseline; each test flips exactly one fact. Campaign 2
 * (Lot R2): the facts are per-family (the service resolves witness + prior
 * claim per family) and startsAtMs is REQUIRED — fail-closed.
 */
const eligibleFacts = (): WalletFacts => ({
  enabled: true,
  maxClaims: 60,
  countedClaims: 5,
  claimsLastHour: 2,
  hourlyCap: 10,
  startsAtMs: NOW - 12 * HOUR,
  endsAtMs: null,
  nowMs: NOW,
  witnessState: 'ok',
  priorClaim: null,
  treasurySpendableXlm: 150,
  rewardXlm: 5,
});

describe('campaignState', () => {
  it('is active with the flag on and budget remaining', () => {
    expect(campaignState(eligibleFacts())).toEqual({ active: true, remainingClaims: 55 });
  });

  it('R2 fail-closed: unset or future startsAt keeps the campaign inactive', () => {
    expect(campaignState({ ...eligibleFacts(), startsAtMs: null }).active).toBe(false);
    expect(campaignState({ ...eligibleFacts(), startsAtMs: NOW + HOUR }).active).toBe(false);
  });

  it('deactivates when the flag is off (dark deploy) or the budget is spent', () => {
    expect(campaignState({ ...eligibleFacts(), enabled: false }).active).toBe(false);
    expect(campaignState({ ...eligibleFacts(), countedClaims: 60 })).toEqual({
      active: false,
      remainingClaims: 0,
    });
  });

  it('never reports negative remaining claims', () => {
    expect(campaignState({ ...eligibleFacts(), countedClaims: 65 }).remainingClaims).toBe(0);
  });

  it('stays active under a velocity pause (temporary, wallet-level only)', () => {
    expect(campaignState({ ...eligibleFacts(), claimsLastHour: 10 }).active).toBe(true);
  });

  it('R3b deadline: past endsAt deactivates, future endsAt does not, null = no deadline', () => {
    expect(campaignState({ ...eligibleFacts(), endsAtMs: NOW - 1 }).active).toBe(false);
    expect(campaignState({ ...eligibleFacts(), endsAtMs: NOW + 36 * HOUR }).active).toBe(true);
    expect(campaignState({ ...eligibleFacts(), endsAtMs: null }).active).toBe(true);
  });
});

describe('walletEligibility', () => {
  it('is eligible on the baseline facts', () => {
    expect(walletEligibility(eligibleFacts())).toEqual({ eligible: true });
  });

  const cases: Array<[string, Partial<WalletFacts>, string]> = [
    ['disabled flag', { enabled: false }, 'faucet-disabled'],
    ['unset startsAt (R2 fail-closed)', { startsAtMs: null }, 'campaign-not-started'],
    ['future startsAt', { startsAtMs: NOW + HOUR }, 'campaign-not-started'],
    ['expired deadline (server-enforced, R3b)', { endsAtMs: NOW - 1 }, 'campaign-ended'],
    ['exhausted budget', { countedClaims: 60 }, 'campaign-exhausted'],
    ['velocity brake at the cap', { claimsLastHour: 10 }, 'temporarily-paused'],
    ['no witness', { witnessState: 'none' }, 'no-qualifying-witness'],
    ['below min notional', { witnessState: 'below-min' }, 'below-min-notional'],
    [
      // Campaign 2: the facts are per-family, so this locks "second claim for
      // the SAME family rejected" — the other family arrives with its own
      // priorClaim: null facts and stays eligible.
      'prior paid claim for this family (double claim)',
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
