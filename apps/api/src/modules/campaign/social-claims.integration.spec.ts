// Lot EP (EP2): integration spec for the social-claim rules the DATABASE
// enforces (stellar_v6_campaign.sql + stellar_v7_social_claim_delete.sql)
// and for CampaignSocialService against the LOCAL dev Postgres. Skipped unless
// CAMPAIGN_IT=1 (CI has no database). Every row it writes is tagged by
// throwaway addresses and deleted in afterAll.
//
//   H. two concurrent claims of one task for one wallet → exactly one claim,
//      one ledger row (the enrollment row lock)
//   cross-wallet: the same handle on another wallet is refused by the rule, and
//      the unique index would be the backstop
//   I. balance = sum(points): claim +20, delete −20 → 0; the ledger keeps both rows
//   delete (SOFT, v7): deleted_at set, handle scrubbed to 'deleted', the
//      credited row keeps its social_claim_id, the adjust row points at it
//   cap: GROSS counting — a re-claim the same UTC day after a delete hits the
//      cap; the next UTC day (seeded counted_day) the re-claim is allowed

import { Keypair } from '@stellar/stellar-sdk';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../db/prisma.service';
import { CampaignRepository } from './campaign.repository';
import { CampaignService } from './campaign.service';
import { CampaignSocialService } from './campaign-social.service';
import { CAMPAIGN_ID } from './campaign-config';
import { SOCIAL_TASKS } from './campaign-rules';

const RUN = process.env.CAMPAIGN_IT === '1';
const d = RUN ? describe : describe.skip;

d('social claims (integration, local Postgres)', () => {
  const prisma = new PrismaService();
  const repo = new CampaignRepository(prisma);
  const campaign = new CampaignService(repo);
  const svc = new CampaignSocialService(repo, campaign);

  const wallet = Keypair.random().publicKey();
  const otherWallet = Keypair.random().publicKey();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const handle = `it_${randomUUID().slice(0, 8)}`;

  const cleanup = async () => {
    for (const a of [wallet, otherWallet]) {
      await prisma.$executeRawUnsafe(`delete from points_ledger where lower(address) = lower($1)`, a);
      await prisma.$executeRawUnsafe(`delete from social_task_claims where lower(address) = lower($1)`, a);
      await prisma.$executeRawUnsafe(`delete from campaign_enrollments where lower(address) = lower($1)`, a);
      await prisma.$executeRawUnsafe(`delete from wallet_ownership_proofs where lower(address) = lower($1)`, a);
    }
  };

  const ledger = (address: string) =>
    prisma.$queryRawUnsafe(
      `select id, reason, points, social_claim_id, adjusts_id, counted_day::text as counted_day
         from points_ledger where campaign = $1 and lower(address) = lower($2) order by id asc`,
      CAMPAIGN_ID,
      address,
    ) as Promise<Array<{ id: bigint; reason: string; points: number; social_claim_id: string | null; adjusts_id: bigint | null; counted_day: string | null }>>;

  beforeAll(async () => {
    await prisma.$connect();
    await cleanup();
    process.env.CAMPAIGN_ENABLED = 'true';
    process.env.CAMPAIGN_STARTS_AT = '2026-10-01T00:00:00Z';
    delete process.env.CAMPAIGN_ENDS_AT;
    for (const [a, u, code] of [[wallet, userId, 'ITSOC001'], [otherWallet, otherUserId, 'ITSOC002']] as const) {
      await repo.upsertBoundProof({ address: a, userId: u, provider: null, nonce: randomUUID().replace(/-/g, ''), variant: 'raw' });
      await repo.insertEnrollment({ campaign: CAMPAIGN_ID, address: a, userId: u, referralCode: code, referredByCode: null });
    }
  });

  afterAll(async () => {
    delete process.env.CAMPAIGN_ENABLED;
    delete process.env.CAMPAIGN_STARTS_AT;
    await cleanup();
    await prisma.$disconnect();
  });

  it('H. two concurrent claims of one task → exactly one claim row and one ledger row', async () => {
    const results = await Promise.all([
      svc.claim({ address: wallet, userId, task: 'x-follow', handle }),
      svc.claim({ address: wallet, userId, task: 'x-follow', handle }),
    ]);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(results.filter((r) => !r.claimed && r.reason === 'already-claimed')).toHaveLength(1);
    const claims = await repo.listSocialClaims(CAMPAIGN_ID, wallet);
    expect(claims.map((c) => c.task_key)).toEqual(['x-follow']);
    const rows = await ledger(wallet);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'social:x-follow', points: SOCIAL_TASKS['x-follow'], social_claim_id: claims[0].id });
    expect(await repo.balance(CAMPAIGN_ID, wallet)).toBe(SOCIAL_TASKS['x-follow']);
  });

  it('the DB CHECK refuses a task outside the closed set, and a social row needs a real claim', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `insert into social_task_claims (campaign, address, task_key, handle_normalized) values ($1, $2, 'tiktok', 'x')`,
        CAMPAIGN_ID,
        otherWallet,
      ),
    ).rejects.toThrow(/social_task_claims_task_check/);
    await expect(
      prisma.$executeRawUnsafe(
        `insert into points_ledger (campaign, address, reason, base_points, points, social_claim_id)
         values ($1, $2, 'social:x-follow', 10, 10, $3::uuid)`,
        CAMPAIGN_ID,
        otherWallet,
        randomUUID(),
      ),
    ).rejects.toThrow(/points_ledger_social_claim_id_fkey/);
  });

  it('one handle per wallet: another wallet cannot use the same handle; the same wallet cannot switch handles', async () => {
    expect(await svc.claim({ address: otherWallet, userId: otherUserId, task: 'community-join', handle })).toMatchObject({
      claimed: false,
      reason: 'handle-already-used',
    });
    expect(await svc.claim({ address: wallet, userId, task: 'community-join', handle: `${handle}_b` })).toMatchObject({
      claimed: false,
      reason: 'handle-mismatch',
    });
    // the unique index is the race backstop for the same task + handle
    await expect(
      prisma.$executeRawUnsafe(
        `insert into social_task_claims (campaign, address, task_key, handle_normalized) values ($1, $2, 'x-follow', $3)`,
        CAMPAIGN_ID,
        otherWallet,
        handle,
      ),
    ).rejects.toThrow(/Key \(campaign, task_key, handle_normalized\)=/);
    expect(await repo.listSocialClaims(CAMPAIGN_ID, otherWallet)).toHaveLength(0);
  });

  it('/me lists the catalogue with the claim id and no handle', async () => {
    const me = await campaign.me({ address: wallet, userId });
    const claimId = (await repo.listSocialClaims(CAMPAIGN_ID, wallet))[0].id;
    expect(me.tasks.find((t) => t.key === 'x-follow')).toMatchObject({ claimed: true, claimId, points: 20 });
    expect(me.tasks.filter((t) => !t.claimed).map((t) => t.key)).toEqual(['x-repost', 'community-join']);
    expect(JSON.stringify(me)).not.toContain(handle);
  });

  it('delete (soft): a foreign id is not-found; the owner gets the adjust row, the claim keeps its id, the handle is scrubbed', async () => {
    const claimId = (await repo.listSocialClaims(CAMPAIGN_ID, wallet))[0].id;
    expect(await svc.remove({ address: otherWallet, userId: otherUserId, id: claimId })).toMatchObject({ deleted: false, reason: 'not-found' });
    expect(await repo.listSocialClaims(CAMPAIGN_ID, wallet)).toHaveLength(1);

    const out = await svc.remove({ address: wallet, userId, id: claimId });
    expect(out).toMatchObject({ deleted: true, id: claimId, pointsReversed: SOCIAL_TASKS['x-follow'] });
    expect(await repo.listSocialClaims(CAMPAIGN_ID, wallet)).toHaveLength(0);
    const rowsLeft = (await prisma.$queryRawUnsafe(
      `select handle_normalized, deleted_at from social_task_claims where id = $1::uuid`,
      claimId,
    )) as Array<{ handle_normalized: string; deleted_at: Date | null }>;
    expect(rowsLeft[0].handle_normalized).toBe('deleted');
    expect(rowsLeft[0].deleted_at).not.toBeNull();
    const handles = (await prisma.$queryRawUnsafe(
      `select count(*)::int as n from social_task_claims where handle_normalized = $1`,
      handle,
    )) as Array<{ n: number }>;
    expect(handles[0].n).toBe(0);

    const rows = await ledger(wallet);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ reason: 'social:x-follow', points: 20, social_claim_id: claimId }); // the row keeps its reference
    expect(rows[1]).toMatchObject({ reason: 'adjust:social-delete', points: -20, social_claim_id: null });
    expect(Number(rows[1].adjusts_id)).toBe(Number(rows[0].id));
    expect(await repo.balance(CAMPAIGN_ID, wallet)).toBe(0); // I.
    // a second delete of the same id → not-found
    expect(await svc.remove({ address: wallet, userId, id: claimId })).toMatchObject({ deleted: false, reason: 'not-found' });
  });

  it('cap is GROSS per UTC day: the other tasks still fit (20 + 10, gross 50) but the deleted task cannot be re-claimed today', async () => {
    process.env.CAMPAIGN_X_REPOST_URL = 'https://x.com/Dig_Agentic/status/1';
    try {
      expect(await svc.claim({ address: wallet, userId, task: 'community-join', handle })).toMatchObject({ claimed: true, points: 20 });
      expect(await svc.claim({ address: wallet, userId, task: 'x-repost', handle })).toMatchObject({ claimed: true, points: 10 });
    } finally {
      delete process.env.CAMPAIGN_X_REPOST_URL;
    }
    // gross today = 20 (deleted) + 20 + 10 = 50 = cap → the re-claim is refused until tomorrow (UTC)
    expect(await svc.claim({ address: wallet, userId, task: 'x-follow', handle })).toMatchObject({ claimed: false, reason: 'social-daily-cap-reached' });
    expect(await repo.balance(CAMPAIGN_ID, wallet)).toBe(30);
    // the handle is still this wallet's (active claims) — not free for another wallet
    expect(await svc.claim({ address: otherWallet, userId: otherUserId, task: 'x-follow', handle })).toMatchObject({ reason: 'handle-already-used' });
    // x-repost is closed again without the URL
    expect(await svc.claim({ address: otherWallet, userId: otherUserId, task: 'x-repost', handle: 'someone_else' })).toMatchObject({ reason: 'task-unavailable' });
  });

  it('next UTC day (seeded counted_day): the deleted task can be claimed again — a NEW claim row, the old one stays deleted', async () => {
    // Move every social credit of the wallet to yesterday: today's gross becomes 0.
    await prisma.$executeRawUnsafe(
      `update points_ledger set counted_day = counted_day - 1
        where campaign = $1 and lower(address) = lower($2) and reason like 'social:%'`,
      CAMPAIGN_ID,
      wallet,
    );
    const out = await svc.claim({ address: wallet, userId, task: 'x-follow', handle });
    expect(out).toMatchObject({ claimed: true, task: 'x-follow', points: 20 });
    const all = (await prisma.$queryRawUnsafe(
      `select id, task_key, handle_normalized, deleted_at from social_task_claims
        where campaign = $1 and lower(address) = lower($2) and task_key = 'x-follow' order by claimed_at asc`,
      CAMPAIGN_ID,
      wallet,
    )) as Array<{ id: string; task_key: string; handle_normalized: string; deleted_at: Date | null }>;
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ handle_normalized: 'deleted' });
    expect(all[0].deleted_at).not.toBeNull();
    expect(all[1]).toMatchObject({ handle_normalized: handle, deleted_at: null });
    expect(out.claimed && out.id).toBe(all[1].id);
    expect(await repo.balance(CAMPAIGN_ID, wallet)).toBe(50);
    expect((await repo.listSocialClaims(CAMPAIGN_ID, wallet)).map((c) => c.task_key).sort()).toEqual(['community-join', 'x-follow', 'x-repost']);
  });
});
