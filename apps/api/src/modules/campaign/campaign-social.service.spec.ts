// Lot EP (EP2): CampaignSocialService with a fake repository and the query
// module mocked (no DB). Pins the claim decision path, the transaction order
// (lock → read → decide → claim → ledger), the unique-key mapping, the PII
// boundary (no handle in any payload), the x-repost availability gate and the
// SOFT delete path (adjust row + soft delete, foreign id = not-found, proof
// required).
import { CampaignSocialService } from './campaign-social.service';
import { CampaignService } from './campaign.service';
import { CampaignRepository } from './campaign.repository';
import { CAMPAIGN_ID } from './campaign-config';
import { DISCLAIMER, SOCIAL_TASKS } from './campaign-rules';
import * as q from './social-claims.queries';

jest.mock('./social-claims.queries');
const Q = q as jest.Mocked<typeof q>;

const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ';
const USER = '00000000-0000-4000-8000-0000000000aa';
const CLAIM_ID = '33333333-3333-4333-8333-333333333333';

function repoStub() {
  const repo = {
    db: { tag: 'pool' },
    hasBoundProof: jest.fn().mockResolvedValue(true),
    todayUtc: jest.fn().mockResolvedValue('2026-10-21'),
    transaction: jest.fn(),
  };
  repo.transaction.mockImplementation(async (fn: (r: CampaignRepository) => Promise<unknown>) =>
    fn({ ...repo, db: { tag: 'tx' } } as unknown as CampaignRepository),
  );
  return repo;
}

function build(repo = repoStub()) {
  const campaign = new CampaignService(repo as unknown as CampaignRepository);
  return { repo, svc: new CampaignSocialService(repo as unknown as CampaignRepository, campaign) };
}

const live = () => {
  process.env.CAMPAIGN_ENABLED = 'true';
  process.env.CAMPAIGN_STARTS_AT = '2026-10-01T00:00:00Z';
  delete process.env.CAMPAIGN_ENDS_AT;
};
const dark = () => {
  delete process.env.CAMPAIGN_ENABLED;
  delete process.env.CAMPAIGN_STARTS_AT;
  delete process.env.CAMPAIGN_ENDS_AT;
};

beforeEach(() => {
  jest.resetAllMocks();
  live();
  Q.lockEnrollment.mockResolvedValue({ id: 'e1', address: ADDRESS, user_id: USER });
  Q.socialClaimHandles.mockResolvedValue([]);
  Q.handleUsedByOtherWallet.mockResolvedValue(false);
  Q.socialPointsAwardedOn.mockResolvedValue(0);
  Q.insertSocialClaim.mockResolvedValue({ id: CLAIM_ID, campaign: CAMPAIGN_ID, address: ADDRESS, task_key: 'x-follow', claimed_at: new Date() });
  Q.insertSocialAward.mockResolvedValue(42);
  Q.findOwnedSocialClaim.mockResolvedValue(null);
  Q.findSocialLedgerRow.mockResolvedValue(null);
  Q.insertSocialDeleteAdjust.mockResolvedValue(43);
  Q.softDeleteSocialClaim.mockResolvedValue(1);
  delete process.env.CAMPAIGN_X_REPOST_URL;
});
afterAll(() => {
  dark();
  delete process.env.CAMPAIGN_X_REPOST_URL;
});

describe('claim', () => {
  it('dark campaign → reason before any DB write (no lock taken)', async () => {
    dark();
    const { repo, svc } = build();
    expect(await svc.claim({ address: ADDRESS, userId: USER, task: 'x-follow', handle: 'alice' })).toEqual({
      claimed: false, reason: 'campaign-disabled', disclaimer: DISCLAIMER,
    });
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('no proof → ownership-proof-required; unknown task → unknown-task; both before the lock', async () => {
    const { repo, svc } = build();
    repo.hasBoundProof.mockResolvedValue(false);
    expect(await svc.claim({ address: ADDRESS, userId: USER, task: 'x-follow', handle: 'alice' })).toMatchObject({ reason: 'ownership-proof-required' });
    repo.hasBoundProof.mockResolvedValue(true);
    expect(await svc.claim({ address: ADDRESS, userId: USER, task: 'nope', handle: 'alice' })).toMatchObject({ reason: 'unknown-task' });
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('x-repost is refused as task-unavailable until CAMPAIGN_X_REPOST_URL is set (then it claims)', async () => {
    const { repo, svc } = build();
    expect(await svc.claim({ address: ADDRESS, userId: USER, task: 'x-repost', handle: 'alice' })).toMatchObject({ claimed: false, reason: 'task-unavailable' });
    expect(repo.transaction).not.toHaveBeenCalled();
    process.env.CAMPAIGN_X_REPOST_URL = 'https://x.com/Dig_Agentic/status/1';
    Q.insertSocialClaim.mockResolvedValue({ id: CLAIM_ID, campaign: CAMPAIGN_ID, address: ADDRESS, task_key: 'x-repost', claimed_at: new Date() });
    expect(await svc.claim({ address: ADDRESS, userId: USER, task: 'x-repost', handle: 'alice' })).toMatchObject({ claimed: true, task: 'x-repost', points: SOCIAL_TASKS['x-repost'] });
  });

  it('not enrolled (no row to lock) → not-enrolled, nothing inserted', async () => {
    Q.lockEnrollment.mockResolvedValue(null);
    const { svc } = build();
    expect(await svc.claim({ address: ADDRESS, userId: USER, task: 'x-follow', handle: 'alice' })).toMatchObject({ claimed: false, reason: 'not-enrolled' });
    expect(Q.insertSocialClaim).not.toHaveBeenCalled();
  });

  it('happy path: lock on the tx client, claim then ledger row with social_claim_id, payload without the handle', async () => {
    const { svc } = build();
    const out = await svc.claim({ address: ADDRESS, userId: USER, task: 'x-follow', handle: 'alice' });
    expect(out).toEqual({ claimed: true, id: CLAIM_ID, task: 'x-follow', points: SOCIAL_TASKS['x-follow'], disclaimer: DISCLAIMER });
    expect(JSON.stringify(out)).not.toContain('alice');

    const tx = { tag: 'tx' };
    expect(Q.lockEnrollment).toHaveBeenCalledWith(tx, CAMPAIGN_ID, ADDRESS);
    expect(Q.insertSocialClaim).toHaveBeenCalledWith(tx, { campaign: CAMPAIGN_ID, address: ADDRESS, taskKey: 'x-follow', handle: 'alice' });
    expect(Q.insertSocialAward).toHaveBeenCalledWith(tx, {
      campaign: CAMPAIGN_ID, address: ADDRESS, userId: USER, reason: 'social:x-follow',
      basePoints: 20, points: 20, claimId: CLAIM_ID, day: '2026-10-21',
    });
    // order: lock → reads → claim → ledger
    const order = [Q.lockEnrollment, Q.socialClaimHandles, Q.insertSocialClaim, Q.insertSocialAward].map((m) => m.mock.invocationCallOrder[0]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('decisions under the lock: already-claimed, handle-mismatch, handle-already-used, daily cap', async () => {
    const { svc } = build();
    const go = () => svc.claim({ address: ADDRESS, userId: USER, task: 'community-join', handle: 'alice' });

    Q.socialClaimHandles.mockResolvedValue([{ task_key: 'community-join', handle_normalized: 'alice' }]);
    expect(await go()).toMatchObject({ reason: 'already-claimed' });

    Q.socialClaimHandles.mockResolvedValue([{ task_key: 'x-follow', handle_normalized: 'bob' }]);
    expect(await go()).toMatchObject({ reason: 'handle-mismatch' });

    Q.socialClaimHandles.mockResolvedValue([]);
    Q.handleUsedByOtherWallet.mockResolvedValue(true);
    expect(await go()).toMatchObject({ reason: 'handle-already-used' });

    Q.handleUsedByOtherWallet.mockResolvedValue(false);
    Q.socialPointsAwardedOn.mockResolvedValue(45);
    expect(await go()).toMatchObject({ reason: 'social-daily-cap-reached' });
    expect(Q.insertSocialClaim).not.toHaveBeenCalled();
  });

  it('maps a lost race on the two unique keys; rethrows anything else', async () => {
    const { svc } = build();
    const pgErr = (key: string) => Object.assign(new Error('duplicate key value violates unique constraint'), {
      meta: { code: '23505', message: `Key (${key})=(x) already exists.` },
    });
    Q.insertSocialClaim.mockRejectedValueOnce(pgErr('campaign, task_key, handle_normalized'));
    expect(await svc.claim({ address: ADDRESS, userId: USER, task: 'x-follow', handle: 'alice' })).toMatchObject({ reason: 'handle-already-used' });
    Q.insertSocialClaim.mockRejectedValueOnce(pgErr('campaign, lower(address), task_key'));
    expect(await svc.claim({ address: ADDRESS, userId: USER, task: 'x-follow', handle: 'alice' })).toMatchObject({ reason: 'already-claimed' });
    Q.insertSocialClaim.mockRejectedValueOnce(new Error('connection reset'));
    await expect(svc.claim({ address: ADDRESS, userId: USER, task: 'x-follow', handle: 'alice' })).rejects.toThrow('connection reset');
  });
});

describe('remove', () => {
  it('proof required, even while the campaign is dark (the handle must always be removable)', async () => {
    dark();
    const { repo, svc } = build();
    repo.hasBoundProof.mockResolvedValue(false);
    expect(await svc.remove({ address: ADDRESS, userId: USER, id: CLAIM_ID })).toEqual({ deleted: false, reason: 'ownership-proof-required', disclaimer: DISCLAIMER });
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('a claim of another wallet (or unknown id) is not-found; nothing written', async () => {
    const { svc } = build();
    expect(await svc.remove({ address: ADDRESS, userId: USER, id: CLAIM_ID })).toEqual({ deleted: false, reason: 'not-found', disclaimer: DISCLAIMER });
    expect(Q.findOwnedSocialClaim).toHaveBeenCalledWith({ tag: 'tx' }, CAMPAIGN_ID, CLAIM_ID, ADDRESS);
    expect(Q.softDeleteSocialClaim).not.toHaveBeenCalled();
    expect(Q.insertSocialDeleteAdjust).not.toHaveBeenCalled();
  });

  it('owned claim: negative adjust row referencing the credited row + SOFT delete in the transaction, works while dark', async () => {
    dark();
    const { svc } = build();
    Q.findOwnedSocialClaim.mockResolvedValue({ id: CLAIM_ID, campaign: CAMPAIGN_ID, address: ADDRESS, task_key: 'x-follow', claimed_at: new Date() });
    Q.findSocialLedgerRow.mockResolvedValue({ id: 42, points: 20, user_id: USER });
    expect(await svc.remove({ address: ADDRESS, userId: USER, id: CLAIM_ID })).toEqual({ deleted: true, id: CLAIM_ID, pointsReversed: 20, disclaimer: DISCLAIMER });
    expect(Q.insertSocialDeleteAdjust).toHaveBeenCalledWith({ tag: 'tx' }, { campaign: CAMPAIGN_ID, address: ADDRESS, userId: USER, adjustsId: 42, points: 20 });
    expect(Q.softDeleteSocialClaim).toHaveBeenCalledWith({ tag: 'tx' }, CAMPAIGN_ID, CLAIM_ID);
    expect(Q.lockEnrollment.mock.invocationCallOrder[0]).toBeLessThan(Q.insertSocialDeleteAdjust.mock.invocationCallOrder[0]);
    expect(Q.insertSocialDeleteAdjust.mock.invocationCallOrder[0]).toBeLessThan(Q.softDeleteSocialClaim.mock.invocationCallOrder[0]);
  });

  it('a claim with no credited row (never happens in practice) is deleted without an adjust row', async () => {
    const { svc } = build();
    Q.findOwnedSocialClaim.mockResolvedValue({ id: CLAIM_ID, campaign: CAMPAIGN_ID, address: ADDRESS, task_key: 'x-follow', claimed_at: new Date() });
    expect(await svc.remove({ address: ADDRESS, userId: USER, id: CLAIM_ID })).toMatchObject({ deleted: true, pointsReversed: 0 });
    expect(Q.insertSocialDeleteAdjust).not.toHaveBeenCalled();
    expect(Q.softDeleteSocialClaim).toHaveBeenCalledTimes(1);
  });
});
