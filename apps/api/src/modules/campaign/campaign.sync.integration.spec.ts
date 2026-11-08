// Lot EP (EP5, item 8): POST /v1/campaign/sync against the LOCAL dev Postgres
// (CAMPAIGN_IT=1 only). The service plans ONE wallet's witnesses under the
// enrollment row lock with the campaign minimum notional and inserts the same
// idempotent ledger rows as the job. Window and witnesses are placed in
// September 2026 so the award suite (window from 2026-10-01, same DB, parallel)
// never selects them; the swap keeps the balance under the first perk tier.
// Every row is deleted in afterAll.

import { Keypair } from '@stellar/stellar-sdk';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../db/prisma.service';
import { CAMPAIGN_ID } from './campaign-config';
import { CampaignRepository } from './campaign.repository';
import { CampaignService, SYNC_RATE_LIMIT_MS } from './campaign.service';

const RUN = process.env.CAMPAIGN_IT === '1';
const d = RUN ? describe : describe.skip;

d('CampaignService.sync (integration, local Postgres)', () => {
  const prisma = new PrismaService();
  const repo = new CampaignRepository(prisma);
  const svc = new CampaignService(repo);
  const wallet = Keypair.random().publicKey();
  const userId = randomUUID();
  const hashes: string[] = [];
  const hash = () => {
    const h = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    hashes.push(h);
    return h;
  };
  const T0 = Date.parse('2026-09-20T12:00:00Z');

  const witness = (txHash: string, kind: string, closedAt: string, notional: number | null) =>
    prisma.$executeRawUnsafe(
      `insert into action_witnesses (tx_hash, network, wallet_address, user_id, kind, op_summary, notional_xlm, min_notional_xlm, meets_min_notional, ledger_closed_at)
       values ($1, 'testnet', $2, $3::uuid, $4, '{}'::jsonb, $5, 1, $6, $7::timestamptz)`,
      txHash,
      wallet,
      userId,
      kind,
      notional,
      notional != null && notional >= 1,
      closedAt,
    );

  const cleanup = async () => {
    await prisma.$executeRawUnsafe(`delete from wallet_perks where lower(address) = lower($1)`, wallet);
    await prisma.$executeRawUnsafe(`delete from points_ledger where lower(address) = lower($1)`, wallet);
    await prisma.$executeRawUnsafe(`delete from campaign_enrollments where lower(address) = lower($1)`, wallet);
    if (hashes.length) await prisma.$executeRawUnsafe(`delete from action_witnesses where tx_hash = any($1::text[])`, hashes);
  };

  beforeAll(async () => {
    await prisma.$connect();
    process.env.CAMPAIGN_ENABLED = 'true';
    process.env.CAMPAIGN_STARTS_AT = '2026-09-01T00:00:00Z';
    process.env.CAMPAIGN_ENDS_AT = '2026-09-30T00:00:00Z';
    process.env.CAMPAIGN_MIN_NOTIONAL_XLM = '2';
    await witness(hash(), 'sdex-swap', '2026-09-20T09:00:00Z', 10); // awarded
    await witness(hash(), 'sdex-swap', '2026-09-20T09:05:00Z', 1.5); // meets the faucet's 1, below the campaign's 2
    await witness(hash(), 'sdex-swap', '2026-09-20T09:10:00Z', null); // unpriced
    await witness(hash(), 'blend-withdraw', '2026-09-20T09:15:00Z', 10); // never awarded
  });

  afterAll(async () => {
    delete process.env.CAMPAIGN_ENABLED;
    delete process.env.CAMPAIGN_STARTS_AT;
    delete process.env.CAMPAIGN_ENDS_AT;
    delete process.env.CAMPAIGN_MIN_NOTIONAL_XLM;
    await cleanup();
    await prisma.$disconnect();
  });

  it('not enrolled yet → enrolled false, nothing written; the qualifying swap already shows as pending (same figure as /me)', async () => {
    const out = await svc.sync({ address: wallet, userId }, T0);
    expect(out).toMatchObject({ active: true, enrolled: false, awarded: 0, pending: 1 });
    expect(await repo.balance(CAMPAIGN_ID, wallet)).toBe(0);
  });

  it('enrolled, two concurrent syncs → the qualifying swap is awarded exactly once (the lock, then the unique index); below-min and unpriced ones are neither awarded nor pending', async () => {
    await repo.insertEnrollment({ campaign: CAMPAIGN_ID, address: wallet, userId, referralCode: 'SYNCIT01', referredByCode: null });
    const a = new CampaignService(repo); // separate in-process rate limiters, same DB
    const b = new CampaignService(repo);
    const [ra, rb] = await Promise.all([a.sync({ address: wallet, userId }, T0), b.sync({ address: wallet, userId }, T0)]);
    expect(ra.awarded + rb.awarded).toBe(1);
    expect([ra, rb].every((r) => r.enrolled && r.pending === 0)).toBe(true);
    const rows = (await prisma.$queryRawUnsafe(
      `select reason, base_points, points, witness_tx_hash, counted_day::text as counted_day from points_ledger where campaign = $1 and lower(address) = lower($2) order by id`,
      CAMPAIGN_ID,
      wallet,
    )) as Array<Record<string, unknown>>;
    expect(rows).toEqual([{ reason: 'action:sdex-swap', base_points: 50, points: 50, witness_tx_hash: hashes[0], counted_day: '2026-09-20' }]);
  });

  it('idempotent: a later sync (past the rate limit) awards nothing more; within the limit it is refused as rateLimited', async () => {
    const first = await svc.sync({ address: wallet, userId }, T0 + SYNC_RATE_LIMIT_MS);
    expect(first).toMatchObject({ enrolled: true, awarded: 0, pending: 0 });
    const limited = await svc.sync({ address: wallet, userId }, T0 + SYNC_RATE_LIMIT_MS + 1);
    expect(limited).toMatchObject({ enrolled: true, awarded: 0, pending: 0, rateLimited: true });
    const again = await svc.sync({ address: wallet, userId }, T0 + 2 * SYNC_RATE_LIMIT_MS);
    expect(again.rateLimited).toBeUndefined();
    // balance stays 50: under the first perk tier on purpose (the award suite's perks step scans every enrolled wallet)
    expect(await repo.balance(CAMPAIGN_ID, wallet)).toBe(50);
  });
});
