// Lot EP (EP1, gate 3): the award job against the LOCAL dev Postgres only,
// gated by CAMPAIGN_IT=1 (CI has no database). Seeds two enrolled wallets, one
// referral link, and witnesses inside / outside the window / below min
// notional / a withdraw / six same-day swaps, plus seven check-in days ending
// on D-1 for the x1.2 multiplier; runs the job twice; asserts the exact ledger
// after run 1, zero new rows after run 2, the referral credited once, and the
// summary counts. Every seeded row is deleted in afterAll.

import { Keypair } from '@stellar/stellar-sdk';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../db/prisma.service';
import { CampaignRepository } from '../modules/campaign/campaign.repository';
import { CAMPAIGN_ID } from '../modules/campaign/campaign-config';
import { previousUtcDay } from '../modules/campaign/campaign-rules';
import { runCampaignAward } from './84-campaign-award';

const RUN = process.env.CAMPAIGN_IT === '1';
const d = RUN ? describe : describe.skip;

d('84-campaign-award (integration, local Postgres)', () => {
  const prisma = new PrismaService();
  const repo = new CampaignRepository(prisma);
  const referee = Keypair.random().publicKey(); // wallet A: acts
  const referrer = Keypair.random().publicKey(); // wallet B: referred A
  const refereeUser = randomUUID();
  const referrerUser = randomUUID();
  const hashes: string[] = [];
  const hash = () => {
    const h = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    hashes.push(h);
    return h;
  };
  const DAY = '2026-10-10';
  const at = (hhmm: string) => `2026-10-10T${hhmm}:00Z`;
  const logs: string[] = [];

  const witness = (txHash: string, kind: string, closedAt: string, meetsMin = true) =>
    prisma.$executeRawUnsafe(
      `insert into action_witnesses (tx_hash, network, wallet_address, user_id, kind, op_summary, notional_xlm, min_notional_xlm, meets_min_notional, ledger_closed_at)
       values ($1, 'testnet', $2, $3::uuid, $4, '{}'::jsonb, 10, 1, $5, $6::timestamptz)`,
      txHash,
      referee,
      refereeUser,
      kind,
      meetsMin,
      closedAt,
    );

  const cleanup = async () => {
    for (const a of [referee, referrer]) {
      await prisma.$executeRawUnsafe(`delete from points_ledger where lower(address) = lower($1)`, a);
      await prisma.$executeRawUnsafe(`delete from referrals where referee_address = $1 or referrer_address = $1`, a);
      await prisma.$executeRawUnsafe(`delete from wallet_daily_checkins where address = $1`, a);
      await prisma.$executeRawUnsafe(`delete from campaign_enrollments where lower(address) = lower($1)`, a);
    }
    if (hashes.length) await prisma.$executeRawUnsafe(`delete from action_witnesses where tx_hash = any($1::text[])`, hashes);
  };

  const ledger = async (address: string) =>
    (await prisma.$queryRawUnsafe(
      `select reason, base_points, multiplier::float as multiplier, points, witness_tx_hash, referral_referee, counted_day::text as counted_day
         from points_ledger where campaign = $1 and lower(address) = lower($2) order by id`,
      CAMPAIGN_ID,
      address,
    )) as Array<Record<string, unknown>>;

  beforeAll(async () => {
    await prisma.$connect();
    process.env.CAMPAIGN_ENABLED = 'true';
    process.env.CAMPAIGN_STARTS_AT = '2026-10-01T00:00:00Z';
    delete process.env.CAMPAIGN_ENDS_AT;

    // enrolments + the referral link (B referred A, linked 2026-10-09)
    await repo.insertEnrollment({ campaign: CAMPAIGN_ID, address: referrer, userId: referrerUser, referralCode: 'AWARDIT1', referredByCode: null });
    await repo.insertEnrollment({ campaign: CAMPAIGN_ID, address: referee, userId: refereeUser, referralCode: 'AWARDIT2', referredByCode: 'AWARDIT1' });
    await prisma.$executeRawUnsafe(
      `insert into referrals (campaign, referee_address, referrer_address, code, linked_at) values ($1, $2, $3, 'AWARDIT1', '2026-10-09T12:00:00Z')`,
      CAMPAIGN_ID,
      referee,
      referrer,
    );

    // seven check-in days ending on D-1 → x1.2 on D
    let cursor = previousUtcDay(DAY);
    for (let i = 0; i < 7; i += 1) {
      await prisma.$executeRawUnsafe(`insert into wallet_daily_checkins (campaign, address, day) values ($1, $2, $3::date)`, CAMPAIGN_ID, referee, cursor);
      cursor = previousUtcDay(cursor);
    }

    // witnesses for A
    await witness(hash(), 'sdex-swap', '2026-09-30T23:59:59Z'); // outside window (before start): never selected
    await witness(hash(), 'sdex-swap', at('08:00'), false); // below min notional: skipped
    await witness(hash(), 'blend-withdraw', at('08:30')); // withdraw: never selected
    for (const hhmm of ['09:00', '09:10', '09:20', '09:30', '09:40', '09:50']) await witness(hash(), 'sdex-swap', at(hhmm)); // 6 swaps → 5 + 1 cap
    await witness(hash(), 'blend-deposit', at('10:00')); // deposit: 100 × 1.2
  });

  afterAll(async () => {
    delete process.env.CAMPAIGN_ENABLED;
    delete process.env.CAMPAIGN_STARTS_AT;
    await cleanup();
    await prisma.$disconnect();
  });

  it('run 1 writes exactly the expected ledger and credits the referral once', async () => {
    const summary = await runCampaignAward(repo, { log: (l) => logs.push(l) });

    expect(summary).toMatchObject({
      dark: false,
      awardedActions: 6, // 5 swaps + 1 deposit
      skippedByReason: { 'outside-window': 0, 'kind-not-awarded': 0, 'below-min-notional': 1, 'daily-cap-reached': 1 },
      referralsCredited: 1,
      referralsPending: 0,
    });
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);

    const a = await ledger(referee);
    const actions = a.filter((r) => String(r.reason).startsWith('action:'));
    expect(actions).toHaveLength(6);
    expect(actions.filter((r) => r.reason === 'action:sdex-swap')).toHaveLength(5);
    for (const r of actions.filter((r) => r.reason === 'action:sdex-swap')) {
      expect(r).toMatchObject({ base_points: 50, multiplier: 1.2, points: 60, counted_day: DAY, referral_referee: null });
      expect(hashes).toContain(r.witness_tx_hash);
    }
    expect(actions.find((r) => r.reason === 'action:blend-deposit')).toMatchObject({ base_points: 100, multiplier: 1.2, points: 120, counted_day: DAY });
    // the capped sixth swap and the below-min one have no row
    expect(a.filter((r) => r.points === 0)).toHaveLength(0);

    const refereeRef = a.filter((r) => String(r.reason).startsWith('referral:'));
    expect(refereeRef).toEqual([
      expect.objectContaining({ reason: 'referral:referee', base_points: 50, multiplier: 1, points: 50, referral_referee: referee, counted_day: DAY, witness_tx_hash: null }),
    ]);
    const b = await ledger(referrer);
    expect(b).toEqual([
      expect.objectContaining({ reason: 'referral:referrer', base_points: 100, multiplier: 1, points: 100, referral_referee: referee, counted_day: DAY }),
    ]);

    const link = (await prisma.$queryRawUnsafe(
      `select credited_at is not null as credited, credited_tx_hash from referrals where campaign = $1 and referee_address = $2`,
      CAMPAIGN_ID,
      referee,
    )) as Array<{ credited: boolean; credited_tx_hash: string }>;
    expect(link[0].credited).toBe(true);
    expect(hashes).toContain(link[0].credited_tx_hash);

    expect(await repo.balance(CAMPAIGN_ID, referee)).toBe(5 * 60 + 120 + 50);
    expect(await repo.balance(CAMPAIGN_ID, referrer)).toBe(100);

    // log lines carry counts only — never an address or a hash
    for (const line of logs) {
      expect(line).not.toContain(referee);
      expect(line).not.toContain(referrer);
      for (const h of hashes) expect(line).not.toContain(h);
    }
    expect(logs.some((l) => l.includes('summary awarded_actions=6'))).toBe(true);
  });

  it('run 2 is a no-op: zero new rows, nothing re-credited', async () => {
    const before = (await ledger(referee)).length + (await ledger(referrer)).length;
    const summary = await runCampaignAward(repo, { log: () => undefined });
    expect(summary).toMatchObject({ awardedActions: 0, referralsCredited: 0, referralsPending: 0 });
    // the below-min and the capped sixth swap are still candidates (no ledger row) and are skipped again each run
    expect(summary.skippedByReason).toEqual({ 'outside-window': 0, 'kind-not-awarded': 0, 'below-min-notional': 1, 'daily-cap-reached': 1 });
    const after = (await ledger(referee)).length + (await ledger(referrer)).length;
    expect(after).toBe(before);
  });

  it('a partial earlier run converges: ledger rows present but link unmarked → marked, no duplicate rows', async () => {
    await prisma.$executeRawUnsafe(`update referrals set credited_at = null, credited_tx_hash = null where campaign = $1 and referee_address = $2`, CAMPAIGN_ID, referee);
    const summary = await runCampaignAward(repo, { log: () => undefined });
    expect(summary.referralsCredited).toBe(1);
    expect((await ledger(referrer)).length).toBe(1);
    expect((await ledger(referee)).filter((r) => r.reason === 'referral:referee')).toHaveLength(1);
  });

  it('dark campaign: exits without touching the DB', async () => {
    delete process.env.CAMPAIGN_ENABLED;
    const summary = await runCampaignAward(repo, { log: (l) => logs.push(l) });
    expect(summary).toMatchObject({ dark: true, awardedActions: 0, referralsCredited: 0 });
    expect(logs.at(-1)).toContain('campaign dark, nothing to award');
    process.env.CAMPAIGN_ENABLED = 'true';
  });
});
