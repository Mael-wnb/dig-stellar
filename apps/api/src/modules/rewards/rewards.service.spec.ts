// Lot EP (EP5): the claim orchestration with a fake repository and a fake
// payout (no DB, no network, no key). Each test pins one path: dark /me, live
// /me mapping, the advisory refusal before any Horizon read, the treasury
// guard, the lock-time refusal, the paid path (one payment, one claim id,
// forward-only marks), the failed path (never retried), the serial queue and
// the ops snapshot's dark behaviour.
import { Keypair } from '@stellar/stellar-sdk';
import { CAMPAIGN_ID } from '../campaign/campaign-config';
import { RewardsPayoutError, type RewardsPayoutService } from './rewards-payout.service';
import type { RewardsRepository } from './rewards.repository';
import { RewardsService } from './rewards.service';
import { xlmToStroops } from './rewards-rules';

const ADDRESS = Keypair.random().publicKey();
const USER = '00000000-0000-4000-8000-0000000000aa';
const CLAIM_ID = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-10-22T10:00:00Z');

type FakeRepo = jest.Mocked<Pick<
  RewardsRepository,
  'allocationsByStatus' | 'paidClaims' | 'hasBoundProof' | 'isEnrolled' | 'hasPayingAllocation' | 'lastClaimAt'
  | 'claimableStroops' | 'beginClaim' | 'markClaimPaid' | 'markClaimFailed' | 'opsCounts'
>>;
type FakePayout = jest.Mocked<Pick<RewardsPayoutService, 'treasuryBalanceXlm' | 'pay' | 'keyAvailable'>>;

function fakeRepo(): FakeRepo {
  return {
    allocationsByStatus: jest.fn().mockResolvedValue([]),
    paidClaims: jest.fn().mockResolvedValue([]),
    hasBoundProof: jest.fn().mockResolvedValue(true),
    isEnrolled: jest.fn().mockResolvedValue(true),
    hasPayingAllocation: jest.fn().mockResolvedValue(false),
    lastClaimAt: jest.fn().mockResolvedValue(null),
    claimableStroops: jest.fn().mockResolvedValue(xlmToStroops('3.5000000')),
    beginClaim: jest.fn().mockResolvedValue({ ok: true, claimId: CLAIM_ID, totalStroops: xlmToStroops('3.5000000'), totalXlm: '3.5000000', days: ['2026-10-20', '2026-10-21'] }),
    markClaimPaid: jest.fn().mockResolvedValue(undefined),
    markClaimFailed: jest.fn().mockResolvedValue(undefined),
    opsCounts: jest.fn().mockResolvedValue({
      allocations: { claimable: 3, paying: 0, paid: 5, failed: 1 },
      claims: { paying: 0, paid: 2, failed: 1 },
      paidXlm: '12.5000000',
      claimableXlm: '4.0000000',
      lastAllocatedDay: '2026-10-21',
    }),
  } as unknown as FakeRepo;
}
function fakePayout(): FakePayout {
  return {
    treasuryBalanceXlm: jest.fn().mockResolvedValue(300),
    pay: jest.fn().mockResolvedValue({ txHash: 'f'.repeat(64) }),
    keyAvailable: jest.fn().mockReturnValue(true),
  } as unknown as FakePayout;
}
const service = (repo: FakeRepo, payout: FakePayout) =>
  new RewardsService(repo as unknown as RewardsRepository, payout as unknown as RewardsPayoutService);

const live = () => {
  process.env.REWARDS_ENABLED = 'true';
  process.env.REWARDS_NETWORK = 'mainnet';
};
afterEach(() => {
  delete process.env.REWARDS_ENABLED;
  delete process.env.REWARDS_NETWORK;
  delete process.env.REWARDS_EXCLUDED_ADDRESSES;
  delete process.env.REWARDS_MIN_CLAIM_XLM;
  jest.restoreAllMocks();
});

describe('me', () => {
  it('dark: zeros, nothing read, the next UTC close and the minimum still served', async () => {
    const repo = fakeRepo();
    const out = await service(repo, fakePayout()).me({ address: ADDRESS, userId: USER }, NOW);
    expect(out).toEqual({
      campaign: CAMPAIGN_ID,
      enabled: false,
      address: ADDRESS,
      claimableXlm: 0,
      pendingDays: [],
      paid: [],
      nextCloseAt: '2026-10-23T00:00:00.000Z',
      minClaimXlm: 1,
    });
    expect(repo.allocationsByStatus).not.toHaveBeenCalled();
  });

  it('live: maps the claimable rows and the paid claims; the total is a stroop-exact sum', async () => {
    live();
    const repo = fakeRepo();
    repo.allocationsByStatus.mockResolvedValue([
      { day: '2026-10-20', points_day: 300, pool_xlm: '100.0000000', cap_xlm: '5.0000000', share_xlm: '2.1234567', status: 'claimable', claim_id: null },
      { day: '2026-10-21', points_day: 55, pool_xlm: '100.0000000', cap_xlm: '5.0000000', share_xlm: '0.3000003', status: 'claimable', claim_id: null },
    ]);
    repo.paidClaims.mockResolvedValue([{ id: CLAIM_ID, total_xlm: '7.0000000', tx_hash: 'a'.repeat(64), paid_at: new Date('2026-10-19T08:00:00Z') }]);
    const out = await service(repo, fakePayout()).me({ address: ADDRESS, userId: USER }, NOW);
    expect(out.enabled).toBe(true);
    expect(out.claimableXlm).toBe(2.423457);
    expect(out.pendingDays).toEqual([
      { day: '2026-10-20', xlm: 2.1234567, pointsDay: 300, poolXlm: 100 },
      { day: '2026-10-21', xlm: 0.3000003, pointsDay: 55, poolXlm: 100 },
    ]);
    expect(out.paid).toEqual([{ claimId: CLAIM_ID, xlm: 7, txHash: 'a'.repeat(64), paidAt: '2026-10-19T08:00:00.000Z' }]);
    expect(repo.allocationsByStatus).toHaveBeenCalledWith(CAMPAIGN_ID, ADDRESS, 'claimable');
    expect(repo.paidClaims).toHaveBeenCalledWith(CAMPAIGN_ID, ADDRESS, 20);
  });
});

describe('claim', () => {
  it('dark: refused before any DB lock or Horizon read', async () => {
    const repo = fakeRepo();
    const payout = fakePayout();
    expect(await service(repo, payout).claim({ address: ADDRESS, userId: USER }, NOW)).toEqual({ claimed: false, reason: 'rewards-disabled' });
    expect(repo.beginClaim).not.toHaveBeenCalled();
    expect(payout.treasuryBalanceXlm).not.toHaveBeenCalled();
  });

  it('advisory refusals never touch Horizon: proof, enrolment, excluded, in-progress, rate limit, nothing, below minimum', async () => {
    live();
    const cases: Array<[(r: FakeRepo) => void, string]> = [
      [(r) => r.hasBoundProof.mockResolvedValue(false), 'ownership-proof-required'],
      [(r) => r.isEnrolled.mockResolvedValue(false), 'not-enrolled'],
      [() => { process.env.REWARDS_EXCLUDED_ADDRESSES = ADDRESS.toLowerCase(); }, 'excluded-address'],
      [(r) => r.hasPayingAllocation.mockResolvedValue(true), 'claim-in-progress'],
      [(r) => r.lastClaimAt.mockResolvedValue(new Date(NOW - 30 * 60_000)), 'claim-rate-limited'],
      [(r) => r.claimableStroops.mockResolvedValue(0n), 'nothing-claimable'],
      [(r) => r.claimableStroops.mockResolvedValue(xlmToStroops('0.5')), 'below-minimum'],
    ];
    for (const [arrange, reason] of cases) {
      delete process.env.REWARDS_EXCLUDED_ADDRESSES;
      const repo = fakeRepo();
      const payout = fakePayout();
      arrange(repo);
      expect(await service(repo, payout).claim({ address: ADDRESS, userId: USER }, NOW)).toEqual({ claimed: false, reason });
      expect(payout.treasuryBalanceXlm).not.toHaveBeenCalled();
      expect(repo.beginClaim).not.toHaveBeenCalled();
    }
  });

  it('treasury guard: the balance is read once, handed to the lock-time decision as stroops (null when unreadable); the repository\'s refusal is returned verbatim', async () => {
    live();
    const repo = fakeRepo();
    const payout = fakePayout();
    payout.treasuryBalanceXlm.mockResolvedValue(5.4999999);
    repo.beginClaim.mockResolvedValue({ ok: false, reason: 'treasury-insufficient' });
    expect(await service(repo, payout).claim({ address: ADDRESS, userId: USER }, NOW)).toEqual({ claimed: false, reason: 'treasury-insufficient' });
    expect(payout.treasuryBalanceXlm).toHaveBeenCalledWith('mainnet');
    expect(repo.beginClaim).toHaveBeenCalledWith(CAMPAIGN_ID, ADDRESS, {
      enabled: true,
      proven: true,
      excluded: false,
      nowMs: NOW,
      rateLimitMs: 3_600_000,
      minClaimStroops: xlmToStroops(1),
      treasuryBalanceStroops: xlmToStroops('5.4999999'),
      reserveStroops: xlmToStroops(2),
    });
    expect(payout.pay).not.toHaveBeenCalled();

    const unreadable = fakePayout();
    unreadable.treasuryBalanceXlm.mockResolvedValue(null);
    const repo2 = fakeRepo();
    repo2.beginClaim.mockResolvedValue({ ok: false, reason: 'treasury-unavailable' });
    await service(repo2, unreadable).claim({ address: ADDRESS, userId: USER }, NOW);
    expect(repo2.beginClaim.mock.calls[0][2].treasuryBalanceStroops).toBeNull();
  });

  it('paid: ONE payment for the locked total with the claim id, then claim + allocations marked paid; the payload carries the hash and the days', async () => {
    live();
    const repo = fakeRepo();
    const payout = fakePayout();
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const out = await service(repo, payout).claim({ address: ADDRESS, userId: USER }, NOW);
    expect(out).toEqual({ claimed: true, status: 'paid', claimId: CLAIM_ID, xlm: 3.5, txHash: 'f'.repeat(64), days: ['2026-10-20', '2026-10-21'] });
    expect(payout.pay).toHaveBeenCalledTimes(1);
    expect(payout.pay).toHaveBeenCalledWith({ network: 'mainnet', destination: ADDRESS, amountXlm: '3.5000000', claimId: CLAIM_ID });
    expect(repo.markClaimPaid).toHaveBeenCalledWith(CLAIM_ID, 'f'.repeat(64));
    expect(repo.markClaimFailed).not.toHaveBeenCalled();
    // log: claim id + amount only — no address, no hash
    const lines = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(lines).toContain(`[rewards] claim ${CLAIM_ID} paid xlm=3.5000000 days=2`);
    expect(lines).not.toContain(ADDRESS);
    expect(lines).not.toContain('f'.repeat(64));
  });

  it('failed: the payout error reason is recorded, nothing is retried, the allocations stay with the failed claim', async () => {
    live();
    const repo = fakeRepo();
    const payout = fakePayout();
    payout.pay.mockRejectedValue(new RewardsPayoutError('submit-ambiguous (status 504): MAY have paid, verify payout on explorer before resolving', true));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const out = await service(repo, payout).claim({ address: ADDRESS, userId: USER }, NOW);
    expect(out).toEqual({ claimed: false, status: 'failed', reason: 'payout-failed', claimId: CLAIM_ID });
    expect(payout.pay).toHaveBeenCalledTimes(1);
    expect(repo.markClaimFailed).toHaveBeenCalledWith(CLAIM_ID, 'submit-ambiguous (status 504): MAY have paid, verify payout on explorer before resolving');
    expect(repo.markClaimPaid).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).not.toContain(ADDRESS);

    // a non-PayoutError (bug / DB) is recorded as payout-error, still never retried
    const repo2 = fakeRepo();
    const payout2 = fakePayout();
    payout2.pay.mockRejectedValue(new Error('unexpected'));
    await service(repo2, payout2).claim({ address: ADDRESS, userId: USER }, NOW);
    expect(repo2.markClaimFailed).toHaveBeenCalledWith(CLAIM_ID, 'payout-error');
  });

  it('claims are serialized: the second claim starts only after the first payout settled', async () => {
    live();
    const repo = fakeRepo();
    const payout = fakePayout();
    const order: string[] = [];
    let release!: () => void;
    payout.pay.mockImplementationOnce(async () => {
      order.push('pay-1-start');
      await new Promise<void>((r) => (release = r));
      order.push('pay-1-end');
      return { txHash: 'a'.repeat(64) };
    });
    payout.pay.mockImplementationOnce(async () => {
      order.push('pay-2');
      return { txHash: 'b'.repeat(64) };
    });
    const svc = service(repo, payout);
    const p1 = svc.claim({ address: ADDRESS, userId: USER }, NOW);
    const p2 = svc.claim({ address: Keypair.random().publicKey(), userId: USER }, NOW);
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['pay-1-start']);
    release();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['pay-1-start', 'pay-1-end', 'pay-2']);
  });
});

describe('getOpsSnapshot', () => {
  it('dark: counts served, the treasury never queried; live: balance included; never an address', async () => {
    const repo = fakeRepo();
    const payout = fakePayout();
    const dark = await service(repo, payout).getOpsSnapshot();
    expect(dark).toMatchObject({ enabled: false, network: 'testnet', campaign: CAMPAIGN_ID, dailyPoolXlm: 100, dailyCapXlm: 5, minClaimXlm: 1, treasuryBalanceXlm: null, reserveXlm: 2, paidXlm: '12.5000000', claimableXlm: '4.0000000', lastAllocatedDay: '2026-10-21' });
    expect(payout.treasuryBalanceXlm).not.toHaveBeenCalled();
    live();
    const liveSnap = await service(repo, payout).getOpsSnapshot();
    expect(liveSnap.treasuryBalanceXlm).toBe(300);
    expect(payout.treasuryBalanceXlm).toHaveBeenCalledWith('mainnet');
    expect(JSON.stringify(liveSnap)).not.toMatch(/G[A-Z2-7]{55}/);
  });
});
