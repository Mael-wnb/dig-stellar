// Lot EP (EP1, gate 2): service specs with a fake repository (no DB), same
// style as the alerts/wallets mock specs. Each test pins one decision path:
// the proof flow (challenge shape, burnt nonce, bad signature, bound/unbound
// proof), the writes (dark campaign, proof required, enrolment + referral,
// check-in), and the reads (me streak maths, leaderboard shortening + cache).

import { Keypair } from '@stellar/stellar-sdk';
import { CampaignService } from './campaign.service';
import { CampaignRepository, type EnrollmentRow, type ProofRow } from './campaign.repository';
import { CHALLENGE_TTL_SECONDS, CAMPAIGN_ID, LEADERBOARD_CACHE_MS } from './campaign-config';
import { DISCLAIMER, REFERRAL_CODE_RE } from './campaign-rules';
import { buildChallengeMessage } from './challenge-message';

const USER = '00000000-0000-4000-8000-0000000000aa';
const WALLET = Keypair.random();
const ADDRESS = WALLET.publicKey();
const OTHER = Keypair.random().publicKey();

const enrollmentRow = (overrides: Partial<EnrollmentRow> = {}): EnrollmentRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  campaign: CAMPAIGN_ID,
  address: ADDRESS,
  user_id: USER,
  referral_code: 'ABCDEFGH',
  referred_by_code: null,
  enrolled_at: new Date('2026-10-10T00:00:00Z'),
  ...overrides,
});

const proofRow = (overrides: Partial<ProofRow> = {}): ProofRow => ({
  id: '22222222-2222-4222-8222-222222222222',
  address: ADDRESS,
  user_id: USER,
  provider: 'freighter',
  nonce: 'a'.repeat(32),
  signature_variant: 'raw',
  verified_at: new Date('2026-10-16T09:00:00Z'),
  consumed_at: null,
  ...overrides,
});

type Fake = jest.Mocked<Pick<
  CampaignRepository,
  | 'createChallenge' | 'deleteStaleChallenges' | 'consumeChallenge' | 'upsertBoundProof' | 'insertUnboundProof'
  | 'hasBoundProof' | 'findEnrollment' | 'findEnrollmentByCode' | 'insertEnrollmentWithCodeRetry' | 'insertReferral'
  | 'referredByCode' | 'checkinToday' | 'checkinDays' | 'todayUtc' | 'balance' | 'leaderboard' | 'rankOf'
  | 'pendingVerificationCount' | 'listSocialClaims' | 'transaction'
>>;

function fakeRepo(): Fake {
  const repo = {
    createChallenge: jest.fn().mockResolvedValue(undefined),
    deleteStaleChallenges: jest.fn().mockResolvedValue(0),
    consumeChallenge: jest.fn().mockResolvedValue(null),
    upsertBoundProof: jest.fn().mockResolvedValue(proofRow()),
    insertUnboundProof: jest.fn().mockResolvedValue(proofRow({ user_id: null })),
    hasBoundProof: jest.fn().mockResolvedValue(true),
    findEnrollment: jest.fn().mockResolvedValue(null),
    findEnrollmentByCode: jest.fn().mockResolvedValue(null),
    insertEnrollmentWithCodeRetry: jest.fn().mockImplementation(async (_p, next: () => string) =>
      enrollmentRow({ referral_code: next() }),
    ),
    insertReferral: jest.fn().mockResolvedValue(undefined),
    referredByCode: jest.fn().mockResolvedValue(null),
    checkinToday: jest.fn().mockResolvedValue({ ok: true, day: '2026-10-16', points: 5, ledgerId: 1 }),
    checkinDays: jest.fn().mockResolvedValue([]),
    todayUtc: jest.fn().mockResolvedValue('2026-10-16'),
    balance: jest.fn().mockResolvedValue(0),
    leaderboard: jest.fn().mockResolvedValue([]),
    rankOf: jest.fn().mockResolvedValue(null),
    pendingVerificationCount: jest.fn().mockResolvedValue(0),
    listSocialClaims: jest.fn().mockResolvedValue([]),
    transaction: jest.fn(),
  } as unknown as Fake;
  // transaction(fn) hands the same fake back, so writes are observable.
  repo.transaction.mockImplementation(async (fn: (r: CampaignRepository) => Promise<unknown>) =>
    fn(repo as unknown as CampaignRepository),
  );
  return repo;
}

function service(repo: Fake): CampaignService {
  return new CampaignService(repo as unknown as CampaignRepository);
}

const liveEnv = () => {
  process.env.CAMPAIGN_ENABLED = 'true';
  process.env.CAMPAIGN_STARTS_AT = '2026-10-01T00:00:00Z';
  delete process.env.CAMPAIGN_ENDS_AT;
};
const darkEnv = () => {
  delete process.env.CAMPAIGN_ENABLED;
  delete process.env.CAMPAIGN_STARTS_AT;
  delete process.env.CAMPAIGN_ENDS_AT;
};

afterEach(darkEnv);

describe('ownership proof (always on, independent of the campaign flags)', () => {
  it('issueChallenge: 32-hex nonce, pinned message, TTL, housekeeping', async () => {
    const repo = fakeRepo();
    const before = Date.now();
    const out = await service(repo).issueChallenge(ADDRESS);
    expect(out.address).toBe(ADDRESS);
    expect(out.nonce).toMatch(/^[0-9a-f]{32}$/);
    const stored = repo.createChallenge.mock.calls[0][0];
    expect(out.message).toBe(
      buildChallengeMessage({ address: ADDRESS, nonce: out.nonce, issuedAtIso: stored.issuedAt.toISOString() }),
    );
    expect(stored.expiresAt.getTime() - stored.issuedAt.getTime()).toBe(CHALLENGE_TTL_SECONDS * 1000);
    expect(new Date(out.expiresAt).getTime()).toBeGreaterThanOrEqual(before + CHALLENGE_TTL_SECONDS * 1000);
    expect(repo.deleteStaleChallenges).toHaveBeenCalledTimes(1);
  });

  it('issueChallenge works while the campaign is dark', async () => {
    darkEnv();
    const out = await service(fakeRepo()).issueChallenge(ADDRESS);
    expect(out.nonce).toHaveLength(32);
  });

  it('verify: unknown / used / expired nonce → challenge-invalid-or-expired, no proof written', async () => {
    const repo = fakeRepo();
    const out = await service(repo).verifyChallenge({
      address: ADDRESS, nonce: 'b'.repeat(32), signedMessage: 'AAAA', provider: null, userId: USER,
    });
    expect(out).toEqual({ ok: false, reason: 'challenge-invalid-or-expired' });
    expect(repo.upsertBoundProof).not.toHaveBeenCalled();
    expect(repo.insertUnboundProof).not.toHaveBeenCalled();
  });

  it('verify: bad signature → signature-invalid, the nonce was consumed (burnt) first, no proof written', async () => {
    const repo = fakeRepo();
    const message = buildChallengeMessage({ address: ADDRESS, nonce: 'c'.repeat(32), issuedAtIso: '2026-10-16T09:00:00.000Z' });
    repo.consumeChallenge.mockResolvedValue(message);
    const wrong = Keypair.random().sign(Buffer.from(message)).toString('base64');
    const out = await service(repo).verifyChallenge({
      address: ADDRESS, nonce: 'c'.repeat(32), signedMessage: wrong, provider: null, userId: USER,
    });
    expect(out).toEqual({ ok: false, reason: 'signature-invalid' });
    expect(repo.consumeChallenge).toHaveBeenCalledWith('c'.repeat(32), ADDRESS);
    expect(repo.upsertBoundProof).not.toHaveBeenCalled();
  });

  it('verify: good signature + userId → bound proof upserted, payload carries variant and verifiedAt', async () => {
    const repo = fakeRepo();
    const message = buildChallengeMessage({ address: ADDRESS, nonce: 'd'.repeat(32), issuedAtIso: '2026-10-16T09:00:00.000Z' });
    repo.consumeChallenge.mockResolvedValue(message);
    const sig = WALLET.sign(Buffer.from(message)).toString('base64');
    const out = await service(repo).verifyChallenge({
      address: ADDRESS, nonce: 'd'.repeat(32), signedMessage: sig, provider: 'freighter', userId: USER,
    });
    expect(out).toEqual({
      ok: true, address: ADDRESS, userId: USER, verifiedAt: '2026-10-16T09:00:00.000Z', signatureVariant: 'raw',
    });
    expect(repo.upsertBoundProof).toHaveBeenCalledWith({
      address: ADDRESS, userId: USER, provider: 'freighter', nonce: 'd'.repeat(32), variant: 'raw',
    });
    expect(repo.insertUnboundProof).not.toHaveBeenCalled();
  });

  it('verify: good signature without userId → unbound proof (user null)', async () => {
    const repo = fakeRepo();
    const message = buildChallengeMessage({ address: ADDRESS, nonce: 'e'.repeat(32), issuedAtIso: '2026-10-16T09:00:00.000Z' });
    repo.consumeChallenge.mockResolvedValue(message);
    const sig = WALLET.sign(Buffer.from(message)).toString('base64');
    const out = await service(repo).verifyChallenge({
      address: ADDRESS, nonce: 'e'.repeat(32), signedMessage: sig, provider: null, userId: null,
    });
    expect(out).toMatchObject({ ok: true, userId: null });
    expect(repo.insertUnboundProof).toHaveBeenCalledTimes(1);
    expect(repo.upsertBoundProof).not.toHaveBeenCalled();
  });

  it('verify: a signature over the SAME text with a swapped wallet is rejected', async () => {
    const repo = fakeRepo();
    const message = buildChallengeMessage({ address: OTHER, nonce: 'f'.repeat(32), issuedAtIso: '2026-10-16T09:00:00.000Z' });
    repo.consumeChallenge.mockResolvedValue(message);
    const sig = WALLET.sign(Buffer.from(message)).toString('base64');
    const out = await service(repo).verifyChallenge({
      address: OTHER, nonce: 'f'.repeat(32), signedMessage: sig, provider: null, userId: USER,
    });
    expect(out).toEqual({ ok: false, reason: 'signature-invalid' });
  });
});

describe('GET /v1/campaign payload', () => {
  it('reports inactive + reason when dark, with the rules and the disclaimer', () => {
    darkEnv();
    const out = service(fakeRepo()).getCampaign();
    expect(out).toMatchObject({ campaign: CAMPAIGN_ID, active: false, reason: 'campaign-disabled', startsAt: null, disclaimer: DISCLAIMER });
    expect(out.rules.actions['sdex-swap'].basePoints).toBe(50);
    expect(out.rules.streakDailyPoints).toBe(5);
    expect(JSON.stringify(out).toLowerCase()).not.toMatch(/airdrop/);
  });

  it('reports active with ISO window when enabled and started', () => {
    liveEnv();
    const out = service(fakeRepo()).getCampaign();
    expect(out).toMatchObject({ active: true, startsAt: '2026-10-01T00:00:00.000Z', endsAt: null });
    expect(out).not.toHaveProperty('reason');
  });
});

describe('enroll', () => {
  it('dark campaign → campaign-disabled, no transaction opened', async () => {
    darkEnv();
    const repo = fakeRepo();
    const out = await service(repo).enroll({ address: ADDRESS, userId: USER, referralCode: null });
    expect(out).toEqual({ enrolled: false, reason: 'campaign-disabled', disclaimer: DISCLAIMER });
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('without a bound proof for (address, userId) → ownership-proof-required, nothing written', async () => {
    liveEnv();
    const repo = fakeRepo();
    repo.hasBoundProof.mockResolvedValue(false);
    const out = await service(repo).enroll({ address: ADDRESS, userId: USER, referralCode: null });
    expect(out).toEqual({ enrolled: false, reason: 'ownership-proof-required', disclaimer: DISCLAIMER });
    expect(repo.insertEnrollmentWithCodeRetry).not.toHaveBeenCalled();
  });

  it('already enrolled → already-enrolled', async () => {
    liveEnv();
    const repo = fakeRepo();
    repo.findEnrollment.mockResolvedValue(enrollmentRow());
    const out = await service(repo).enroll({ address: ADDRESS, userId: USER, referralCode: null });
    expect(out).toMatchObject({ enrolled: false, reason: 'already-enrolled' });
  });

  it('unknown referral code → invalid-referral-code; own code → self-referral', async () => {
    liveEnv();
    const repo = fakeRepo();
    expect(await service(repo).enroll({ address: ADDRESS, userId: USER, referralCode: 'ZZZZZZZZ' })).toMatchObject({
      enrolled: false, reason: 'invalid-referral-code',
    });
    repo.findEnrollmentByCode.mockResolvedValue(enrollmentRow({ address: ADDRESS, referral_code: 'MYOWNCDE' }));
    expect(await service(repo).enroll({ address: ADDRESS, userId: USER, referralCode: 'MYOWNCDE' })).toMatchObject({
      enrolled: false, reason: 'self-referral',
    });
    expect(repo.insertReferral).not.toHaveBeenCalled();
  });

  it('success without a code: enrolment inserted inside the transaction with a fresh 8-char code', async () => {
    liveEnv();
    const repo = fakeRepo();
    const out = await service(repo).enroll({ address: ADDRESS, userId: USER, referralCode: null });
    expect(out).toMatchObject({ enrolled: true, address: ADDRESS, referredBy: null, disclaimer: DISCLAIMER });
    expect((out as { referralCode: string }).referralCode).toMatch(REFERRAL_CODE_RE);
    expect(repo.transaction).toHaveBeenCalledTimes(1);
    expect(repo.insertEnrollmentWithCodeRetry.mock.calls[0][0]).toEqual({
      campaign: CAMPAIGN_ID, address: ADDRESS, userId: USER, referredByCode: null,
    });
    expect(repo.insertReferral).not.toHaveBeenCalled();
  });

  it('success with a valid code: referral row links referee → referrer, payload returns the code only', async () => {
    liveEnv();
    const repo = fakeRepo();
    repo.findEnrollmentByCode.mockResolvedValue(enrollmentRow({ address: OTHER, referral_code: 'FRIENDCD' }));
    const out = await service(repo).enroll({ address: ADDRESS, userId: USER, referralCode: 'FRIENDCD' });
    expect(out).toMatchObject({ enrolled: true, referredBy: 'FRIENDCD' });
    expect(repo.insertReferral).toHaveBeenCalledWith({
      campaign: CAMPAIGN_ID, refereeAddress: ADDRESS, referrerAddress: OTHER, code: 'FRIENDCD',
    });
    expect(JSON.stringify(out)).not.toContain(OTHER);
  });

  it('a concurrent enrolment losing the (campaign, wallet) race is reported as already-enrolled', async () => {
    liveEnv();
    const repo = fakeRepo();
    repo.insertEnrollmentWithCodeRetry.mockRejectedValue({
      meta: { code: '23505', message: `Key (campaign, lower(address))=(1, ${ADDRESS.toLowerCase()}) already exists.` },
    });
    const out = await service(repo).enroll({ address: ADDRESS, userId: USER, referralCode: null });
    expect(out).toMatchObject({ enrolled: false, reason: 'already-enrolled' });
  });

  it('any other DB error propagates (never masked as a reason)', async () => {
    liveEnv();
    const repo = fakeRepo();
    repo.insertEnrollmentWithCodeRetry.mockRejectedValue(new Error('connection refused'));
    await expect(service(repo).enroll({ address: ADDRESS, userId: USER, referralCode: null })).rejects.toThrow('connection refused');
  });
});

describe('checkin', () => {
  it('dark → campaign-disabled before any DB write; proof missing → ownership-proof-required', async () => {
    darkEnv();
    const repo = fakeRepo();
    expect(await service(repo).checkin({ address: ADDRESS, userId: USER })).toMatchObject({ checkedIn: false, reason: 'campaign-disabled' });
    expect(repo.checkinToday).not.toHaveBeenCalled();
    liveEnv();
    repo.hasBoundProof.mockResolvedValue(false);
    expect(await service(repo).checkin({ address: ADDRESS, userId: USER })).toMatchObject({ checkedIn: false, reason: 'ownership-proof-required' });
    expect(repo.checkinToday).not.toHaveBeenCalled();
  });

  it('delegates enrolled + once-per-day to the locked repository write and maps its reasons', async () => {
    liveEnv();
    const repo = fakeRepo();
    expect(await service(repo).checkin({ address: ADDRESS, userId: USER })).toEqual({
      checkedIn: true, day: '2026-10-16', points: 5, disclaimer: DISCLAIMER,
    });
    repo.checkinToday.mockResolvedValue({ ok: false, reason: 'already-checked-in' });
    expect(await service(repo).checkin({ address: ADDRESS, userId: USER })).toMatchObject({ checkedIn: false, reason: 'already-checked-in' });
    repo.checkinToday.mockResolvedValue({ ok: false, reason: 'not-enrolled' });
    expect(await service(repo).checkin({ address: ADDRESS, userId: USER })).toMatchObject({ checkedIn: false, reason: 'not-enrolled' });
  });
});

describe('me', () => {
  it('streak.current ends today when checked in today, otherwise yesterday; multiplierForToday is from D-1', async () => {
    liveEnv();
    const repo = fakeRepo();
    repo.todayUtc.mockResolvedValue('2026-10-16');
    repo.checkinDays.mockResolvedValue(['2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09']);
    repo.findEnrollment.mockResolvedValue(enrollmentRow());
    repo.balance.mockResolvedValue(135);
    repo.referredByCode.mockResolvedValue('FRIENDCD');
    repo.pendingVerificationCount.mockResolvedValue(2);

    const notYetToday = await service(repo).me({ address: ADDRESS, userId: USER });
    expect(notYetToday).toMatchObject({
      active: true, proven: true, enrolled: true, referralCode: 'ABCDEFGH', referredBy: 'FRIENDCD', balance: 135,
      streak: { current: 7, multiplierForToday: 1.2 }, checkedInToday: false, pendingVerification: 2, perks: [], disclaimer: DISCLAIMER,
    });

    repo.checkinDays.mockResolvedValue(['2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09']);
    const afterCheckin = await service(repo).me({ address: ADDRESS, userId: USER });
    expect(afterCheckin.streak).toEqual({ current: 8, multiplierForToday: 1.2 }); // still from D-1 (7 days)
    expect(afterCheckin.checkedInToday).toBe(true);
  });

  it('EP2: tasks lists the whole catalogue with claimed state and claim id, never a handle', async () => {
    liveEnv();
    const repo = fakeRepo();
    repo.findEnrollment.mockResolvedValue(enrollmentRow());
    repo.listSocialClaims.mockResolvedValue([
      { id: '33333333-3333-4333-8333-333333333333', campaign: CAMPAIGN_ID, address: ADDRESS, task_key: 'x-follow', claimed_at: new Date('2026-10-16T08:00:00Z') },
    ]);
    const out = await service(repo).me({ address: ADDRESS, userId: USER });
    expect(out.tasks).toEqual([
      { key: 'x-follow', points: 20, url: null, available: true, claimed: true, claimId: '33333333-3333-4333-8333-333333333333', claimedAt: '2026-10-16T08:00:00.000Z' },
      { key: 'x-repost', points: 10, url: null, available: false, claimed: false, claimId: null, claimedAt: null },
      { key: 'community-join', points: 20, url: null, available: true, claimed: false, claimId: null, claimedAt: null },
    ]);
    expect(JSON.stringify(out)).not.toContain('handle');
  });

  it('EP2: x-repost carries CAMPAIGN_X_REPOST_URL (https only) and is available only when it is set', () => {
    const svc = service(fakeRepo());
    delete process.env.CAMPAIGN_X_REPOST_URL;
    expect(svc.getCampaign().rules.socialTasks['x-repost']).toEqual({ points: 10, url: null, available: false });
    process.env.CAMPAIGN_X_REPOST_URL = 'http://x.com/not-https';
    expect(svc.getCampaign().rules.socialTasks['x-repost']).toEqual({ points: 10, url: null, available: false });
    process.env.CAMPAIGN_X_REPOST_URL = ' https://x.com/Dig_Agentic/status/123 ';
    expect(svc.getCampaign().rules.socialTasks['x-repost']).toEqual({ points: 10, url: 'https://x.com/Dig_Agentic/status/123', available: true });
    expect(svc.getCampaign().rules.socialTasks['x-follow']).toEqual({ points: 20, url: null, available: true });
    delete process.env.CAMPAIGN_X_REPOST_URL;
  });

  it('a broken streak reads 0 and x1.0; a dark campaign still answers with reason', async () => {
    darkEnv();
    const repo = fakeRepo();
    repo.checkinDays.mockResolvedValue(['2026-10-13']);
    const out = await service(repo).me({ address: ADDRESS, userId: USER });
    expect(out).toMatchObject({ active: false, reason: 'campaign-disabled', enrolled: false, streak: { current: 0, multiplierForToday: 1 } });
  });
});

describe('leaderboard', () => {
  it('ranks, shortens every address, never leaks a full address, and caches 60 s', async () => {
    const repo = fakeRepo();
    repo.leaderboard.mockResolvedValue([{ address: OTHER, points: 300 }, { address: ADDRESS, points: 120 }]);
    repo.rankOf.mockResolvedValue({ rank: 2, points: 120 });
    const svc = service(repo);
    const t0 = 1_800_000_000_000;

    const first = await svc.leaderboard(ADDRESS, t0);
    expect(first.rows).toEqual([
      { rank: 1, address: `${OTHER.slice(0, 4)}…${OTHER.slice(-4)}`, points: 300 },
      { rank: 2, address: `${ADDRESS.slice(0, 4)}…${ADDRESS.slice(-4)}`, points: 120 },
    ]);
    expect(first.me).toEqual({ rank: 2, points: 120 });
    expect(JSON.stringify(first)).not.toContain(OTHER);
    expect(JSON.stringify(first)).not.toContain(ADDRESS);

    await svc.leaderboard(null, t0 + LEADERBOARD_CACHE_MS - 1);
    expect(repo.leaderboard).toHaveBeenCalledTimes(1);
    await svc.leaderboard(null, t0 + LEADERBOARD_CACHE_MS + 1);
    expect(repo.leaderboard).toHaveBeenCalledTimes(2);
  });
});

describe('violatedUniqueKey (Postgres "Key (…)=" detail vs constraint-name drivers)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { violatedUniqueKey, ENROLLMENT_CODE_KEY, ENROLLMENT_WALLET_KEY } = require('./campaign.repository');
  it('parses the key columns Prisma relays', () => {
    expect(violatedUniqueKey({ meta: { message: 'Key (campaign, referral_code)=(1, ABCDEFGH) already exists.' } })).toBe(ENROLLMENT_CODE_KEY);
    expect(violatedUniqueKey(new Error('Raw query failed. Code: `23505`. Message: `Key (campaign, lower(address))=(1, gabc) already exists.`'))).toBe(ENROLLMENT_WALLET_KEY);
  });
  it('falls back to a constraint name, else null', () => {
    expect(violatedUniqueKey({ message: 'duplicate key value violates unique constraint "uq_x"' })).toBe('uq_x');
    expect(violatedUniqueKey(new Error('connection refused'))).toBeNull();
    expect(violatedUniqueKey(null)).toBeNull();
  });
});
