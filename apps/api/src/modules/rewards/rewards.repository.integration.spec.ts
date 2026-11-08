// Lot EP (EP5): integration spec for stellar_v9_rewards.sql + RewardsRepository
// against the LOCAL dev Postgres only. Skipped unless CAMPAIGN_IT=1 (CI has no
// database). MONEY PATH: every expectation is an exact 7-decimal figure.
//
//   1. allocation of a closed day is idempotent across two runs (PK)
//   2. closed-day-only: today's points are never allocated; the grace holds
//      yesterday back until 00:30Z
//   3. an excluded address is neither allocated nor counted in the Σ
//   4. the claim transaction marks the rows 'paying' with a claim id and
//      refuses a second concurrent claim; paid / failed finalisation; the
//      rate limit and the minimum under the lock
//   5. the CHECK constraints refuse a backwards or inconsistent row
//
// Every row it writes is tagged by throwaway addresses AND a throwaway campaign
// id (IT_CAMPAIGN): the allocation step scans every closed day of a campaign,
// and the other integration suites run in parallel on campaign 1 with their
// own enrolled wallets, so sharing the id would make both sides see each
// other's rows. Everything is deleted in afterAll.
// REWARDS_* env is set in-process only (names only; no key is ever involved —
// nothing here pays).

import { Keypair } from '@stellar/stellar-sdk';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../db/prisma.service';
import { previousUtcDay } from '../campaign/campaign-rules';
import { RewardsRepository, type ClaimContext } from './rewards.repository';
import { xlmToStroops } from './rewards-rules';

const RUN = process.env.CAMPAIGN_IT === '1';
const d = RUN ? describe : describe.skip;

/** Throwaway campaign id: isolates this suite from the campaign-1 suites running in parallel. */
const IT_CAMPAIGN = 905;

d('RewardsRepository (integration, local Postgres)', () => {
  const prisma = new PrismaService();
  const repo = new RewardsRepository(prisma);
  const A = Keypair.random().publicKey(); // 300 points on D-3
  const B = Keypair.random().publicKey(); // 100 points on D-3
  const X = Keypair.random().publicKey(); // 800 points on D-3, EXCLUDED
  const N = Keypair.random().publicKey(); // 50 points on D-3 but NOT enrolled
  const wallets = [A, B, X, N];
  const logs: string[] = [];
  let today = '';
  let D1 = '';
  let D3 = '';

  const ledgerRow = (address: string, points: number, day: string) =>
    prisma.$executeRawUnsafe(
      `insert into points_ledger (campaign, address, user_id, reason, base_points, multiplier, points, counted_day)
       values ($1, $2, null, 'adjust:ep5-it', 0, 1, $3, $4::date)`,
      IT_CAMPAIGN,
      address,
      points,
      day,
    );

  const allocations = async (address: string) =>
    (await prisma.$queryRawUnsafe(
      `select day::text as day, points_day, pool_xlm::text as pool_xlm, cap_xlm::text as cap_xlm, share_xlm::text as share_xlm, status, claim_id::text as claim_id
         from reward_allocations where campaign = $1 and lower(address) = lower($2) order by day`,
      IT_CAMPAIGN,
      address,
    )) as Array<Record<string, unknown>>;

  const cleanup = async () => {
    for (const a of wallets) {
      await prisma.$executeRawUnsafe(`delete from reward_allocations where lower(address) = lower($1)`, a);
      await prisma.$executeRawUnsafe(`delete from reward_claims where lower(address) = lower($1)`, a);
      await prisma.$executeRawUnsafe(`delete from points_ledger where lower(address) = lower($1)`, a);
      await prisma.$executeRawUnsafe(`delete from campaign_enrollments where lower(address) = lower($1)`, a);
    }
  };

  const ctx = (patch: Partial<ClaimContext> = {}): ClaimContext => ({
    enabled: true,
    proven: true,
    excluded: false,
    nowMs: Date.now(),
    rateLimitMs: 3_600_000,
    minClaimStroops: xlmToStroops(1),
    treasuryBalanceStroops: xlmToStroops(300),
    reserveStroops: xlmToStroops(2),
    ...patch,
  });

  beforeAll(async () => {
    await prisma.$connect();
    await cleanup();
    today = await repo.todayUtc();
    D1 = previousUtcDay(today);
    D3 = previousUtcDay(previousUtcDay(D1));

    process.env.REWARDS_ENABLED = 'true';
    process.env.REWARDS_DAILY_POOL_XLM = '100';
    process.env.REWARDS_DAILY_CAP_XLM = '80';
    process.env.REWARDS_EXCLUDED_ADDRESSES = ` ${X.toLowerCase()} , not-an-address`;

    for (const [address, code] of [[A, 'EP5ITAAA'], [B, 'EP5ITBBB'], [X, 'EP5ITXXX']] as Array<[string, string]>) {
      await prisma.$executeRawUnsafe(
        `insert into campaign_enrollments (campaign, address, user_id, referral_code) values ($1, $2, $3::uuid, $4)`,
        IT_CAMPAIGN,
        address,
        randomUUID(),
        code,
      );
    }
    // D-3: A 300 (two rows), B 100, X 800 (excluded), N 50 (not enrolled); a negative adjust on A must not count
    await ledgerRow(A, 200, D3);
    await ledgerRow(A, 100, D3);
    await ledgerRow(A, -40, D3);
    await ledgerRow(B, 100, D3);
    await ledgerRow(X, 800, D3);
    await ledgerRow(N, 50, D3);
    // today: never closed
    await ledgerRow(A, 500, today);
    // D-1: inside the grace until 00:30Z
    await ledgerRow(B, 10, D1);
  });

  afterAll(async () => {
    await cleanup();
    delete process.env.REWARDS_ENABLED;
    delete process.env.REWARDS_DAILY_POOL_XLM;
    delete process.env.REWARDS_DAILY_CAP_XLM;
    delete process.env.REWARDS_EXCLUDED_ADDRESSES;
    await prisma.$disconnect();
  });

  it('1+3. run 1 allocates D-3 by points among enrolled, non-excluded wallets; the excluded wallet dilutes nobody', async () => {
    // Clock pinned to D-1 00:10Z: D-3 is closed, D-1 is inside the grace, today is open.
    const nowMs = Date.parse(`${today}T00:10:00Z`);
    const summary = await repo.allocateClosedDays(IT_CAMPAIGN, { nowMs, log: (l) => logs.push(l) });
    expect(summary).toMatchObject({
      dark: false,
      daysPending: 2, // D-3 and D-1
      daysWaitingGrace: 1, // D-1
      daysAllocated: 1,
      allocations: 2, // A and B
      excludedWallets: 1, // X
      distributedXlm: '100.0000000',
      remainderXlm: '0.0000000',
      poolXlm: 100,
      capXlm: 80,
    });
    expect(await allocations(A)).toEqual([
      { day: D3, points_day: 300, pool_xlm: '100.0000000', cap_xlm: '80.0000000', share_xlm: '75.0000000', status: 'claimable', claim_id: null },
    ]);
    expect(await allocations(B)).toEqual([
      { day: D3, points_day: 100, pool_xlm: '100.0000000', cap_xlm: '80.0000000', share_xlm: '25.0000000', status: 'claimable', claim_id: null },
    ]);
    expect(await allocations(X)).toEqual([]);
    expect(await allocations(N)).toEqual([]);
    const line = logs.find((l) => l.includes(`rewards day=${D3}`));
    expect(line).toContain('wallets=3 excluded=1 points=400 allocated=2 distributed_xlm=100.0000000 remainder_xlm=0.0000000 pool_xlm=100.0000000 cap_xlm=80.0000000');
    for (const l of logs) for (const a of wallets) expect(l).not.toContain(a.slice(0, 12));
  });

  it('1. run 2 is a no-op (PK idempotency) and the day is no longer pending', async () => {
    const nowMs = Date.parse(`${today}T00:10:00Z`);
    const summary = await repo.allocateClosedDays(IT_CAMPAIGN, { nowMs });
    expect(summary).toMatchObject({ daysPending: 1, daysWaitingGrace: 1, daysAllocated: 0, allocations: 0, distributedXlm: '0.0000000' });
    expect(await allocations(A)).toHaveLength(1);
  });

  it('2. closed-day-only: once past the grace D-1 is allocated (cap applied), today never is', async () => {
    const nowMs = Date.parse(`${today}T00:30:00Z`);
    process.env.REWARDS_DAILY_CAP_XLM = '5'; // the cap used is stored on the row
    const summary = await repo.allocateClosedDays(IT_CAMPAIGN, { nowMs });
    expect(summary).toMatchObject({ daysPending: 1, daysWaitingGrace: 0, daysAllocated: 1, allocations: 1, distributedXlm: '5.0000000', remainderXlm: '95.0000000' });
    expect(await allocations(B)).toEqual([
      expect.objectContaining({ day: D3, share_xlm: '25.0000000' }),
      { day: D1, points_day: 10, pool_xlm: '100.0000000', cap_xlm: '5.0000000', share_xlm: '5.0000000', status: 'claimable', claim_id: null },
    ]);
    expect((await allocations(A)).map((r) => r.day)).toEqual([D3]); // A's 500 points today: not closed
    expect(await repo.pendingClosedDays(IT_CAMPAIGN, today)).toEqual([]);
  });

  it('dark: with REWARDS_ENABLED unset the step reads and writes nothing', async () => {
    delete process.env.REWARDS_ENABLED;
    await ledgerRow(A, 7, previousUtcDay(D3));
    const summary = await repo.allocateClosedDays(IT_CAMPAIGN, {});
    expect(summary).toMatchObject({ dark: true, daysPending: 0, allocations: 0 });
    expect((await allocations(A)).map((r) => r.day)).toEqual([D3]);
    process.env.REWARDS_ENABLED = 'true';
  });

  it('reads: claimable total in stroops, by status, proofs and enrolment', async () => {
    expect(await repo.claimableStroops(IT_CAMPAIGN, B)).toBe(xlmToStroops('30.0000000'));
    expect(await repo.claimableStroops(IT_CAMPAIGN, X)).toBe(0n);
    expect((await repo.allocationsByStatus(IT_CAMPAIGN, B, 'claimable')).map((r) => r.day)).toEqual([D3, D1]);
    expect(await repo.hasPayingAllocation(IT_CAMPAIGN, B)).toBe(false);
    expect(await repo.lastClaimAt(IT_CAMPAIGN, B)).toBeNull();
    expect(await repo.isEnrolled(IT_CAMPAIGN, A)).toBe(true);
    expect(await repo.isEnrolled(IT_CAMPAIGN, N)).toBe(false);
    expect(await repo.hasBoundProof(A, randomUUID())).toBe(false);
  });

  it('4. beginClaim: two concurrent claims for one wallet → exactly one marks the rows; the loser sees claim-in-progress', async () => {
    const results = await Promise.all([repo.beginClaim(IT_CAMPAIGN, B, ctx()), repo.beginClaim(IT_CAMPAIGN, B, ctx())]);
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toEqual([{ ok: false, reason: 'claim-in-progress' }]);
    const win = winners[0] as Extract<(typeof results)[number], { ok: true }>;
    expect(win.totalXlm).toBe('30.0000000');
    expect(win.totalStroops).toBe(xlmToStroops(30));
    expect(win.days).toEqual([D3, D1]);

    const rows = await allocations(B);
    expect(rows.map((r) => r.status)).toEqual(['paying', 'paying']);
    expect(rows.map((r) => r.claim_id)).toEqual([win.claimId, win.claimId]);
    const claim = (await prisma.$queryRawUnsafe(
      `select status, total_xlm::text as total_xlm, tx_hash, failure_reason from reward_claims where id = $1::uuid`,
      win.claimId,
    )) as Array<Record<string, unknown>>;
    expect(claim).toEqual([{ status: 'paying', total_xlm: '30.0000000', tx_hash: null, failure_reason: null }]);

    // a third attempt while paying is refused the same way, nothing claimable → still 'claim-in-progress' first
    expect(await repo.beginClaim(IT_CAMPAIGN, B, ctx())).toEqual({ ok: false, reason: 'claim-in-progress' });

    // paid: the claim and its rows move forward together
    await repo.markClaimPaid(win.claimId, 'ep5-it-hash-' + win.claimId);
    expect((await allocations(B)).map((r) => r.status)).toEqual(['paid', 'paid']);
    expect(await repo.paidClaims(IT_CAMPAIGN, B, 10)).toEqual([
      expect.objectContaining({ id: win.claimId, total_xlm: '30.0000000', tx_hash: 'ep5-it-hash-' + win.claimId }),
    ]);
    // markClaimPaid is a forward-only transition: a second call changes nothing
    await repo.markClaimPaid(win.claimId, 'another-hash');
    expect((await repo.paidClaims(IT_CAMPAIGN, B, 10))[0].tx_hash).toBe('ep5-it-hash-' + win.claimId);
  });

  it('4. the rate limit holds under the lock: a new claimable row right after a paid claim is refused for an hour', async () => {
    await prisma.$executeRawUnsafe(
      `insert into reward_allocations (campaign, day, address, points_day, pool_xlm, cap_xlm, share_xlm)
       values ($1, $2::date, $3, 1, 100, 5, 2.5)`,
      IT_CAMPAIGN,
      previousUtcDay(D3),
      B,
    );
    expect(await repo.beginClaim(IT_CAMPAIGN, B, ctx())).toEqual({ ok: false, reason: 'claim-rate-limited' });
    // an hour later it passes the limit, and the minimum / treasury are judged on the locked total
    const later = Date.now() + 3_600_000 + 1_000;
    expect(await repo.beginClaim(IT_CAMPAIGN, B, ctx({ nowMs: later, minClaimStroops: xlmToStroops(3) }))).toEqual({ ok: false, reason: 'below-minimum' });
    expect(await repo.beginClaim(IT_CAMPAIGN, B, ctx({ nowMs: later, treasuryBalanceStroops: xlmToStroops('4.4999999') }))).toEqual({ ok: false, reason: 'treasury-insufficient' });
    expect(await repo.beginClaim(IT_CAMPAIGN, B, ctx({ nowMs: later, treasuryBalanceStroops: null }))).toEqual({ ok: false, reason: 'treasury-unavailable' });
    expect(await repo.beginClaim(IT_CAMPAIGN, B, ctx({ nowMs: later, enabled: false }))).toEqual({ ok: false, reason: 'rewards-disabled' });
    expect(await repo.beginClaim(IT_CAMPAIGN, B, ctx({ nowMs: later, proven: false }))).toEqual({ ok: false, reason: 'ownership-proof-required' });
    expect(await repo.beginClaim(IT_CAMPAIGN, B, ctx({ nowMs: later, excluded: true }))).toEqual({ ok: false, reason: 'excluded-address' });
    expect(await repo.beginClaim(IT_CAMPAIGN, N, ctx({ nowMs: later }))).toEqual({ ok: false, reason: 'not-enrolled' });
    expect(await repo.beginClaim(IT_CAMPAIGN, A, ctx({ nowMs: later, minClaimStroops: xlmToStroops(90) }))).toEqual({ ok: false, reason: 'below-minimum' });

    // failed: rows stay 'failed' with the reason, nothing is retried or reopened
    const second = await repo.beginClaim(IT_CAMPAIGN, B, ctx({ nowMs: later }));
    expect(second).toMatchObject({ ok: true, totalXlm: '2.5000000' });
    const id = (second as { claimId: string }).claimId;
    await repo.markClaimFailed(id, 'submit-ambiguous (status none): MAY have paid');
    expect((await allocations(B)).map((r) => r.status)).toEqual(['failed', 'paid', 'paid']) // ordered by day: the D-4 row first;
    const claim = (await prisma.$queryRawUnsafe(`select status, failure_reason, tx_hash from reward_claims where id = $1::uuid`, id)) as Array<Record<string, unknown>>;
    expect(claim).toEqual([{ status: 'failed', failure_reason: 'submit-ambiguous (status none): MAY have paid', tx_hash: null }]);
    expect(await repo.claimableStroops(IT_CAMPAIGN, B)).toBe(0n);
    // nothing claimable left → the next attempt (past the rate limit) says so
    expect(await repo.beginClaim(IT_CAMPAIGN, B, ctx({ nowMs: later + 3_600_000 }))).toEqual({ ok: false, reason: 'nothing-claimable' });
  });

  it('ops counts: per-status counters and sums, no address', async () => {
    const ops = await repo.opsCounts(IT_CAMPAIGN);
    expect(ops.allocations.paid).toBeGreaterThanOrEqual(2);
    expect(ops.allocations.failed).toBeGreaterThanOrEqual(1);
    expect(ops.claims.paid).toBeGreaterThanOrEqual(1);
    expect(ops.claims.failed).toBeGreaterThanOrEqual(1);
    expect(ops.paidXlm).toMatch(/^\d+\.\d{7}$/);
    expect(ops.claimableXlm).toMatch(/^\d+\.\d{7}$/);
    expect(ops.lastAllocatedDay).not.toBeNull();
    for (const a of wallets) expect(JSON.stringify(ops)).not.toContain(a);
  });

  it('5. the CHECK constraints refuse inconsistent rows', async () => {
    const day = previousUtcDay(previousUtcDay(D3));
    // share above the cap
    await expect(
      prisma.$executeRawUnsafe(
        `insert into reward_allocations (campaign, day, address, points_day, pool_xlm, cap_xlm, share_xlm) values ($1, $2::date, $3, 1, 100, 5, 5.0000001)`,
        IT_CAMPAIGN, day, A,
      ),
    ).rejects.toThrow(/reward_allocations_share_xlm_check/);
    // paying without a claim id
    await expect(
      prisma.$executeRawUnsafe(
        `insert into reward_allocations (campaign, day, address, points_day, pool_xlm, cap_xlm, share_xlm, status) values ($1, $2::date, $3, 1, 100, 5, 1, 'paying')`,
        IT_CAMPAIGN, day, A,
      ),
    ).rejects.toThrow(/reward_allocations_claim_check/);
    // paid claim without a hash
    await expect(
      prisma.$executeRawUnsafe(
        `insert into reward_claims (campaign, address, total_xlm, status) values ($1, $2, 1, 'paid')`,
        IT_CAMPAIGN, A,
      ),
    ).rejects.toThrow(/reward_claims_paid_check/);
    // unknown status
    await expect(
      prisma.$executeRawUnsafe(
        `insert into reward_claims (campaign, address, total_xlm, status) values ($1, $2, 1, 'refunded')`,
        IT_CAMPAIGN, A,
      ),
    ).rejects.toThrow(/reward_claims_status_check/);
  });
});
