// Lot EP (EP1, gate 1-bis): integration spec for the DB-enforced rules of
// stellar_v6_campaign.sql and CampaignRepository, run against the LOCAL dev
// Postgres only. Skipped unless CAMPAIGN_IT=1 (CI has no database). Uses the
// api's own PrismaService (DATABASE_URL from apps/api/.env). Every row it
// writes is tagged by a throwaway address and deleted in afterAll.
//
//   F. nonce consumption is atomic and single-use (concurrent + sequential)
//   H. two concurrent check-ins for one wallet → exactly one succeeds
//   I. balance = sum(points)
//   G. "day" is UTC even when the session time zone is Europe/Paris
//   A–D. the CHECK constraints and FK reject bad ledger rows

import { Keypair } from '@stellar/stellar-sdk';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../db/prisma.service';
import { CampaignRepository } from './campaign.repository';
import { CampaignService } from './campaign.service';
import { CAMPAIGN_ID, RECOVERY_PROOF_MAX_AGE_SECONDS } from './campaign-config';

const RUN = process.env.CAMPAIGN_IT === '1';
const d = RUN ? describe : describe.skip;

d('CampaignRepository (integration, local Postgres)', () => {
  const prisma = new PrismaService();
  const repo = new CampaignRepository(prisma);
  const wallet = Keypair.random().publicKey();
  const otherWallet = Keypair.random().publicKey();
  const userId = randomUUID();

  const thirdWallet = Keypair.random().publicKey();
  const witnessHash = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

  const cleanup = async () => {
    for (const a of [wallet, otherWallet, thirdWallet]) {
      await prisma.$executeRawUnsafe(`delete from points_ledger where lower(address) = lower($1)`, a);
      await prisma.$executeRawUnsafe(`delete from referrals where referee_address = $1 or referrer_address = $1`, a);
      await prisma.$executeRawUnsafe(`delete from wallet_daily_checkins where address = $1`, a);
      await prisma.$executeRawUnsafe(`delete from campaign_enrollments where lower(address) = lower($1)`, a);
      await prisma.$executeRawUnsafe(`delete from wallet_ownership_proofs where lower(address) = lower($1)`, a);
      await prisma.$executeRawUnsafe(`delete from wallet_auth_challenges where address = $1`, a);
    }
    await prisma.$executeRawUnsafe(`delete from action_witnesses where tx_hash = $1`, witnessHash);
  };

  beforeAll(async () => {
    await prisma.$connect();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('F. challenge consumption', () => {
    it('is single-use: first consume returns the message, every later one null', async () => {
      const nonce = randomUUID().replace(/-/g, '');
      await repo.createChallenge({
        nonce,
        address: wallet,
        message: 'm1',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(await repo.consumeChallenge(nonce, wallet)).toBe('m1');
      expect(await repo.consumeChallenge(nonce, wallet)).toBeNull();
    });

    it('two concurrent consumes of one nonce: exactly one wins', async () => {
      const nonce = randomUUID().replace(/-/g, '');
      await repo.createChallenge({
        nonce,
        address: wallet,
        message: 'm2',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      const results = await Promise.all([repo.consumeChallenge(nonce, wallet), repo.consumeChallenge(nonce, wallet)]);
      expect(results.filter((r) => r === 'm2')).toHaveLength(1);
      expect(results.filter((r) => r === null)).toHaveLength(1);
    });

    it('refuses an expired nonce and a nonce issued for another address', async () => {
      const expired = randomUUID().replace(/-/g, '');
      await repo.createChallenge({
        nonce: expired,
        address: wallet,
        message: 'm3',
        issuedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 1_000),
      });
      expect(await repo.consumeChallenge(expired, wallet)).toBeNull();

      const foreign = randomUUID().replace(/-/g, '');
      await repo.createChallenge({
        nonce: foreign,
        address: wallet,
        message: 'm4',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(await repo.consumeChallenge(foreign, otherWallet)).toBeNull();
      // …and the failed attempt did NOT burn it for the right address (the WHERE never matched).
      expect(await repo.consumeChallenge(foreign, wallet)).toBe('m4');
    });

    it('D. a lowercase or malformed address is rejected by the CHECK', async () => {
      await expect(
        repo.createChallenge({
          nonce: randomUUID().replace(/-/g, ''),
          address: wallet.toLowerCase(),
          message: 'x',
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ).rejects.toThrow(/wallet_auth_challenges_address_check/);
    });
  });

  describe('H. check-in under the enrollment lock', () => {
    it('refuses a wallet that is not enrolled', async () => {
      expect(await repo.checkinToday(CAMPAIGN_ID, wallet)).toEqual({ ok: false, reason: 'not-enrolled' });
    });

    it('two concurrent check-ins for one wallet → exactly one succeeds, one ledger row, balance 5', async () => {
      await repo.insertEnrollment({
        campaign: CAMPAIGN_ID,
        address: wallet,
        userId,
        referralCode: 'ITTEST01',
        referredByCode: null,
      });

      const [a, b] = await Promise.all([repo.checkinToday(CAMPAIGN_ID, wallet), repo.checkinToday(CAMPAIGN_ID, wallet)]);
      const oks = [a, b].filter((r) => r.ok);
      const dups = [a, b].filter((r) => !r.ok && r.reason === 'already-checked-in');
      expect(oks).toHaveLength(1);
      expect(dups).toHaveLength(1);

      const rows = (await prisma.$queryRawUnsafe(
        `select count(*)::int as n from points_ledger where lower(address) = lower($1) and reason = 'streak:daily'`,
        wallet,
      )) as Array<{ n: number }>;
      expect(rows[0].n).toBe(1);

      // I. balance is the sum of the ledger
      expect(await repo.balance(CAMPAIGN_ID, wallet)).toBe(5);

      // a third, sequential attempt the same day is also refused
      expect(await repo.checkinToday(CAMPAIGN_ID, wallet)).toEqual({ ok: false, reason: 'already-checked-in' });
      expect(await repo.checkinDays(CAMPAIGN_ID, wallet)).toHaveLength(1);
    });
  });

  describe('G. UTC day in SQL', () => {
    it("(ts at time zone 'utc')::date is the UTC day even with the session in Europe/Paris", async () => {
      const rows = (await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local time zone 'Europe/Paris'`);
        return tx.$queryRawUnsafe(
          `select ('2026-10-15T22:30:00Z'::timestamptz at time zone 'utc')::date::text as utc_day,
                  ('2026-10-15T22:30:00Z'::timestamptz)::date::text as session_day`,
        );
      })) as Array<{ utc_day: string; session_day: string }>;
      expect(rows[0].utc_day).toBe('2026-10-15');
      expect(rows[0].session_day).toBe('2026-10-16'); // what a naive ::date would have stored
    });
  });

  describe('A–D. ledger constraints', () => {
    const insert = (sql: string, ...args: unknown[]) => prisma.$executeRawUnsafe(sql, ...args);

    it('B. rejects a reason outside the closed set', async () => {
      await expect(
        insert(
          `insert into points_ledger (campaign, address, reason, base_points, points, checkin_day)
           values ($1, $2, 'bonus:100', 1, 1, current_date)`,
          CAMPAIGN_ID,
          wallet,
        ),
      ).rejects.toThrow(/points_ledger_reason_check/);
    });

    it('A. rejects an action row without a witness, and a witness hash that does not exist', async () => {
      await expect(
        insert(
          `insert into points_ledger (campaign, address, reason, base_points, points)
           values ($1, $2, 'action:sdex-swap', 50, 50)`,
          CAMPAIGN_ID,
          wallet,
        ),
      ).rejects.toThrow(/points_ledger_reference_check/);
      await expect(
        insert(
          `insert into points_ledger (campaign, address, reason, base_points, points, witness_tx_hash)
           values ($1, $2, 'action:sdex-swap', 50, 50, repeat('0', 64))`,
          CAMPAIGN_ID,
          wallet,
        ),
      ).rejects.toThrow(/points_ledger_witness_tx_hash_fkey/);
    });

    it('A. rejects a streak row that also carries a referral reference', async () => {
      await expect(
        insert(
          `insert into points_ledger (campaign, address, reason, base_points, points, checkin_day, referral_referee)
           values ($1, $2, 'streak:daily', 5, 5, current_date, $3)`,
          CAMPAIGN_ID,
          wallet,
          otherWallet,
        ),
      ).rejects.toThrow(/points_ledger_reference_check/);
    });

    it('C. rejects multiplier out of [1, 2], negative base, and negative points outside adjust:*', async () => {
      const base = `insert into points_ledger (campaign, address, reason, base_points, multiplier, points, checkin_day)`;
      await expect(
        insert(`${base} values ($1, $2, 'streak:daily', 5, 2.5, 12, '2030-01-01')`, CAMPAIGN_ID, wallet),
      ).rejects.toThrow(/points_ledger_multiplier_check/);
      await expect(
        insert(`${base} values ($1, $2, 'streak:daily', -5, 1, 0, '2030-01-02')`, CAMPAIGN_ID, wallet),
      ).rejects.toThrow(/points_ledger_base_points_check/);
      await expect(
        insert(`${base} values ($1, $2, 'streak:daily', 5, 1, -5, '2030-01-03')`, CAMPAIGN_ID, wallet),
      ).rejects.toThrow(/points_ledger_points_check/);
    });

    it('A. an adjust row may be negative and may point at the corrected row', async () => {
      const original = (await prisma.$queryRawUnsafe(
        `select id from points_ledger where lower(address) = lower($1) and reason = 'streak:daily' limit 1`,
        wallet,
      )) as Array<{ id: bigint | number }>;
      await expect(
        insert(
          `insert into points_ledger (campaign, address, reason, base_points, multiplier, points, adjusts_id)
           values ($1, $2, 'adjust:it-spec-revoke', 0, 1, -5, $3)`,
          CAMPAIGN_ID,
          wallet,
          Number(original[0].id),
        ),
      ).resolves.toBe(1);
      expect(await repo.balance(CAMPAIGN_ID, wallet)).toBe(0);
    });

    it('A. the check-in idempotency index is per wallet: another wallet may hold the same checkin_day', async () => {
      await repo.insertEnrollment({
        campaign: CAMPAIGN_ID,
        address: otherWallet,
        userId: randomUUID(),
        referralCode: 'ITTEST02',
        referredByCode: null,
      });
      const r = await repo.checkinToday(CAMPAIGN_ID, otherWallet);
      expect(r.ok).toBe(true);
    });
  });
  describe('ownership proofs', () => {
    it('upsertBoundProof: one row per (address, userId); a second proof refreshes it', async () => {
      const first = await repo.upsertBoundProof({ address: wallet, userId, provider: 'freighter', nonce: 'n'.repeat(32), variant: 'raw' });
      const second = await repo.upsertBoundProof({ address: wallet, userId, provider: 'xbull', nonce: 'm'.repeat(32), variant: 'sha256' });
      expect(second.id).toBe(first.id);
      expect(second.provider).toBe('xbull');
      expect(second.signature_variant).toBe('sha256');
      expect(second.verified_at.getTime()).toBeGreaterThanOrEqual(first.verified_at.getTime());
      expect(await repo.hasBoundProof(wallet, userId)).toBe(true);
      expect(await repo.hasBoundProof(wallet, randomUUID())).toBe(false);
    });

    it('consumeUnboundProof: fresh unbound proof consumed exactly once and bound to the user; stale ones ignored', async () => {
      const newUser = randomUUID();
      await repo.insertUnboundProof({ address: otherWallet, provider: null, nonce: 'u'.repeat(32), variant: 'raw' });
      const [a, b] = await Promise.all([
        repo.consumeUnboundProof(otherWallet, newUser, RECOVERY_PROOF_MAX_AGE_SECONDS),
        repo.consumeUnboundProof(otherWallet, newUser, RECOVERY_PROOF_MAX_AGE_SECONDS),
      ]);
      const consumed = [a, b].filter((r) => r != null);
      expect(consumed).toHaveLength(1);
      expect(consumed[0]).toMatchObject({ address: otherWallet, user_id: newUser });
      expect(consumed[0]!.consumed_at).not.toBeNull();
      expect(await repo.consumeUnboundProof(otherWallet, newUser, RECOVERY_PROOF_MAX_AGE_SECONDS)).toBeNull();

      // an unbound proof older than the max age is never consumed
      const stale = await repo.insertUnboundProof({ address: otherWallet, provider: null, nonce: 'v'.repeat(32), variant: 'raw' });
      await prisma.$executeRawUnsafe(
        `update wallet_ownership_proofs set verified_at = now() - interval '2 hours' where id = $1::uuid`,
        stale.id,
      );
      expect(await repo.consumeUnboundProof(otherWallet, randomUUID(), RECOVERY_PROOF_MAX_AGE_SECONDS)).toBeNull();
    });

    it('D. the variant CHECK refuses anything but raw / sha256', async () => {
      await expect(
        repo.insertUnboundProof({ address: wallet, provider: null, nonce: 'w'.repeat(32), variant: 'ed25519-prefixed' as never }),
      ).rejects.toThrow(/wallet_ownership_proofs_variant_check/);
    });
  });

  describe('enrolment transaction (service + repository, real DB)', () => {
    const live = () => {
      process.env.CAMPAIGN_ENABLED = 'true';
      process.env.CAMPAIGN_STARTS_AT = '2026-10-01T00:00:00Z';
      delete process.env.CAMPAIGN_ENDS_AT;
    };
    afterAll(() => {
      delete process.env.CAMPAIGN_ENABLED;
      delete process.env.CAMPAIGN_STARTS_AT;
    });

    it('insertEnrollmentWithCodeRetry retries ONCE on a referral-code collision via a savepoint, inside one transaction', async () => {
      const takenCode = (await repo.findEnrollment(CAMPAIGN_ID, wallet))!.referral_code; // 'ITTEST01' from the H block
      const codes = [takenCode, 'ITTEST03'];
      const row = await repo.transaction((r) =>
        r.insertEnrollmentWithCodeRetry(
          { campaign: CAMPAIGN_ID, address: thirdWallet, userId: randomUUID(), referredByCode: null },
          () => codes.shift()!,
        ),
      );
      expect(row.referral_code).toBe('ITTEST03');
      expect(codes).toHaveLength(0);
      // the transaction survived the first failed statement (savepoint rollback) and committed
      expect((await repo.findEnrollment(CAMPAIGN_ID, thirdWallet))?.referral_code).toBe('ITTEST03');
    });

    it('a wallet-level collision propagates with its key columns (not swallowed)', async () => {
      await expect(
        repo.transaction((r) =>
          r.insertEnrollmentWithCodeRetry(
            { campaign: CAMPAIGN_ID, address: thirdWallet, userId: randomUUID(), referredByCode: null },
            () => 'ITTEST04',
          ),
        ),
      ).rejects.toThrow(/Key \(campaign, lower\(address\)\)=/);
    });

    it('service.enroll with a referral code writes the enrolment and the referral link in one transaction', async () => {
      live();
      const svc = new CampaignService(repo);
      const referee = Keypair.random().publicKey();
      const refereeUser = randomUUID();
      try {
        // no proof yet → refused, nothing written
        expect(await svc.enroll({ address: referee, userId: refereeUser, referralCode: 'ITTEST03' })).toMatchObject({
          enrolled: false, reason: 'ownership-proof-required',
        });
        await repo.upsertBoundProof({ address: referee, userId: refereeUser, provider: null, nonce: 'r'.repeat(32), variant: 'raw' });

        // self-referral through the real lookup
        await repo.upsertBoundProof({ address: thirdWallet, userId: (await repo.findEnrollment(CAMPAIGN_ID, thirdWallet))!.user_id, provider: null, nonce: 's'.repeat(32), variant: 'raw' });
        const out = await svc.enroll({ address: referee, userId: refereeUser, referralCode: 'ITTEST03' });
        expect(out).toMatchObject({ enrolled: true, referredBy: 'ITTEST03' });
        expect(await repo.referredByCode(CAMPAIGN_ID, referee)).toBe('ITTEST03');
        const link = (await prisma.$queryRawUnsafe(
          `select referrer_address, credited_at from referrals where campaign = $1 and referee_address = $2`,
          CAMPAIGN_ID,
          referee,
        )) as Array<{ referrer_address: string; credited_at: Date | null }>;
        expect(link[0]).toEqual({ referrer_address: thirdWallet, credited_at: null });
        // second enrolment of the same wallet → already-enrolled
        expect(await svc.enroll({ address: referee, userId: refereeUser, referralCode: null })).toMatchObject({ enrolled: false, reason: 'already-enrolled' });
      } finally {
        await prisma.$executeRawUnsafe(`delete from referrals where referee_address = $1`, referee);
        await prisma.$executeRawUnsafe(`delete from campaign_enrollments where lower(address) = lower($1)`, referee);
        await prisma.$executeRawUnsafe(`delete from wallet_ownership_proofs where lower(address) = lower($1)`, referee);
      }
    });
  });

  describe('leaderboard, rank and pending verification (real SQL)', () => {
    it('ranks by sum(points) desc, address asc; rankOf agrees; zero balances are not listed', async () => {
      // wallet: 5 (streak) - 5 (adjust) = 0 → excluded; otherWallet: 5; thirdWallet: no rows
      const rows = await repo.leaderboard(CAMPAIGN_ID, 50);
      const mine = rows.filter((r) => [wallet, otherWallet, thirdWallet].includes(r.address));
      expect(mine).toEqual([{ address: otherWallet, points: 5 }]);
      expect(await repo.rankOf(CAMPAIGN_ID, wallet)).toBeNull();
      const r = await repo.rankOf(CAMPAIGN_ID, otherWallet);
      expect(r?.points).toBe(5);
      expect(r?.rank).toBeGreaterThanOrEqual(1);
    });

    it('pendingVerificationCount counts awardable in-window witnesses without a ledger row, and drops once awarded', async () => {
      await prisma.$executeRawUnsafe(
        `insert into action_witnesses (tx_hash, network, wallet_address, user_id, kind, op_summary, notional_xlm, min_notional_xlm, meets_min_notional, ledger_closed_at)
         values ($1, 'testnet', $2, $3::uuid, 'sdex-swap', '{}'::jsonb, 10, 1, true, '2026-10-10T12:00:00Z')`,
        witnessHash,
        wallet,
        userId,
      );
      const window = { startsAtMs: Date.UTC(2026, 9, 1), endsAtMs: null };
      expect(await repo.pendingVerificationCount(CAMPAIGN_ID, wallet, window)).toBe(1);
      expect(await repo.pendingVerificationCount(CAMPAIGN_ID, wallet, { startsAtMs: Date.UTC(2026, 9, 11), endsAtMs: null })).toBe(0);
      expect(await repo.pendingVerificationCount(CAMPAIGN_ID, wallet, { startsAtMs: null, endsAtMs: null })).toBe(0);

      await prisma.$executeRawUnsafe(
        `insert into points_ledger (campaign, address, user_id, reason, base_points, multiplier, points, witness_tx_hash, counted_day)
         values ($1, $2, $3::uuid, 'action:sdex-swap', 50, 1, 50, $4, '2026-10-10')`,
        CAMPAIGN_ID,
        wallet,
        userId,
        witnessHash,
      );
      expect(await repo.pendingVerificationCount(CAMPAIGN_ID, wallet, window)).toBe(0);
      // A. the witness idempotency index refuses a second award for the same tx
      await expect(
        prisma.$executeRawUnsafe(
          `insert into points_ledger (campaign, address, user_id, reason, base_points, multiplier, points, witness_tx_hash, counted_day)
           values ($1, $2, $3::uuid, 'action:sdex-swap', 50, 1, 50, $4, '2026-10-10')`,
          CAMPAIGN_ID,
          wallet,
          userId,
          witnessHash,
        ),
      ).rejects.toThrow(/Key \(campaign, reason, witness_tx_hash\)=/);
    });
  });

  describe('EP3: perks rows and metrics facts (real SQL)', () => {
    // Own throwaway rows, a window in 2030 so no other local row can fall inside it;
    // the campaign-scoped counts (enrolled, referrals, social, points, perks) are
    // asserted as deltas because the local DB may hold real campaign rows.
    const a = Keypair.random().publicKey();
    const b = Keypair.random().publicKey();
    const userA = randomUUID();
    const userB = randomUUID();
    const hashes: string[] = [];
    const hash = () => {
      const h = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      hashes.push(h);
      return h;
    };
    const WINDOW = { startsAtMs: Date.UTC(2030, 0, 1), endsAtMs: Date.UTC(2030, 0, 2) };
    const IN = '2030-01-01T12:00:00Z';
    const OUT = '2030-01-02T00:00:00Z'; // endsAt is exclusive
    let before: Awaited<ReturnType<typeof repo.metricsFacts>>;

    const seedWitness = (address: string, userId: string, kind: string, closedAt: string) =>
      prisma.$executeRawUnsafe(
        `insert into action_witnesses (tx_hash, network, wallet_address, user_id, kind, op_summary, notional_xlm, min_notional_xlm, meets_min_notional, ledger_closed_at)
         values ($1, 'testnet', $2, $3::uuid, $4, '{}'::jsonb, 10, 1, true, $5::timestamptz)`,
        hash(),
        address,
        userId,
        kind,
        closedAt,
      );

    const cleanupEp3 = async () => {
      for (const addr of [a, b]) {
        await prisma.$executeRawUnsafe(`delete from wallet_perks where lower(address) = lower($1)`, addr);
        await prisma.$executeRawUnsafe(`delete from points_ledger where lower(address) = lower($1)`, addr);
        await prisma.$executeRawUnsafe(`delete from social_task_claims where lower(address) = lower($1)`, addr);
        await prisma.$executeRawUnsafe(`delete from referrals where referee_address = $1 or referrer_address = $1`, addr);
        await prisma.$executeRawUnsafe(`delete from campaign_enrollments where lower(address) = lower($1)`, addr);
        await prisma.$executeRawUnsafe(`delete from wallet_ownership_proofs where lower(address) = lower($1)`, addr);
        await prisma.$executeRawUnsafe(`delete from user_wallets where address = $1`, addr);
      }
      if (hashes.length) await prisma.$executeRawUnsafe(`delete from action_witnesses where tx_hash = any($1::text[])`, hashes);
    };

    beforeAll(async () => {
      await cleanupEp3();
      before = await repo.metricsFacts(CAMPAIGN_ID, WINDOW);

      // registered: A inside the window, B outside (at endsAt, exclusive)
      await prisma.$executeRawUnsafe(
        `insert into user_wallets (user_id, chain, address, created_at) values ($1::uuid, 'stellar', $2, $3::timestamptz)`,
        userA, a, IN,
      );
      await prisma.$executeRawUnsafe(
        `insert into user_wallets (user_id, chain, address, created_at) values ($1::uuid, 'stellar', $2, $3::timestamptz)`,
        userB, b, OUT,
      );
      // proven: A twice inside the window (distinct → 1), B outside
      await repo.upsertBoundProof({ address: a, userId: userA, provider: null, nonce: 'n1', variant: 'raw' });
      await repo.insertUnboundProof({ address: a, provider: null, nonce: 'n2', variant: 'raw' });
      await prisma.$executeRawUnsafe(`update wallet_ownership_proofs set verified_at = $2::timestamptz where lower(address) = lower($1)`, a, IN);
      await repo.upsertBoundProof({ address: b, userId: userB, provider: null, nonce: 'n3', variant: 'raw' });
      await prisma.$executeRawUnsafe(`update wallet_ownership_proofs set verified_at = $2::timestamptz where lower(address) = lower($1)`, b, OUT);
      // enrolled: both
      await repo.insertEnrollment({ campaign: CAMPAIGN_ID, address: a, userId: userA, referralCode: 'EP3METRA', referredByCode: null });
      await repo.insertEnrollment({ campaign: CAMPAIGN_ID, address: b, userId: userB, referralCode: 'EP3METRB', referredByCode: 'EP3METRA' });
      // witnesses: A swap + deposit + withdraw inside, A swap outside; B withdraw only (not an awardable kind)
      await seedWitness(a, userA, 'sdex-swap', IN);
      await seedWitness(a, userA, 'blend-deposit', IN);
      await seedWitness(a, userA, 'blend-withdraw', IN);
      await seedWitness(a, userA, 'sdex-swap', OUT);
      await seedWitness(b, userB, 'blend-withdraw', IN);
      // referrals: one credited, one not
      await prisma.$executeRawUnsafe(
        `insert into referrals (campaign, referee_address, referrer_address, code, credited_at) values ($1, $2, $3, 'EP3METRA', now())`,
        CAMPAIGN_ID, b, a,
      );
      // social: one active, one soft-deleted
      await prisma.$executeRawUnsafe(
        `insert into social_task_claims (campaign, address, task_key, handle_normalized) values ($1, $2, 'x-follow', $3)`,
        CAMPAIGN_ID, a, `ep3_${a.slice(1, 9).toLowerCase()}`,
      );
      await prisma.$executeRawUnsafe(
        `insert into social_task_claims (campaign, address, task_key, handle_normalized, deleted_at) values ($1, $2, 'x-follow', 'deleted', now())`,
        CAMPAIGN_ID, b,
      );
      // points: +50 (action) and -20 (adjust) → issued counts positives only
      await repo.insertActionAward({
        campaign: CAMPAIGN_ID, address: a, userId: userA, reason: 'action:sdex-swap',
        basePoints: 50, multiplier: 1, points: 50, witnessTxHash: hashes[0], countedDay: '2030-01-01',
      });
      await prisma.$executeRawUnsafe(
        `insert into points_ledger (campaign, address, user_id, reason, base_points, multiplier, points)
         values ($1, $2, $3::uuid, 'adjust:it-metrics', 0, 1, -20)`,
        CAMPAIGN_ID, a, userA,
      );
    });

    afterAll(cleanupEp3);

    it('insertPerk is idempotent on the primary key; listPerks returns key + grantedAt only', async () => {
      expect(await repo.insertPerk({ campaign: CAMPAIGN_ID, address: a, perkKey: 'early-access', pointsAtGrant: 100 })).toBe(1);
      expect(await repo.insertPerk({ campaign: CAMPAIGN_ID, address: a, perkKey: 'early-access', pointsAtGrant: 999 })).toBe(0);
      expect(await repo.insertPerk({ campaign: CAMPAIGN_ID, address: b, perkKey: 'beta-features', pointsAtGrant: 500 })).toBe(1);
      const rows = await repo.listPerks(CAMPAIGN_ID, a);
      expect(rows).toHaveLength(1);
      expect(rows[0].perk_key).toBe('early-access');
      expect(rows[0].granted_at).toBeInstanceOf(Date);
      expect(Object.keys(rows[0]).sort()).toEqual(['granted_at', 'perk_key']);
    });

    it('wallet_perks CHECKs refuse an unknown perk key, a bad address and a negative points_at_grant', async () => {
      await expect(
        repo.insertPerk({ campaign: CAMPAIGN_ID, address: a, perkKey: 'vip' as never, pointsAtGrant: 0 }),
      ).rejects.toThrow(/wallet_perks_perk_key_check/);
      await expect(
        repo.insertPerk({ campaign: CAMPAIGN_ID, address: a.toLowerCase(), perkKey: 'priority-rwa', pointsAtGrant: 0 }),
      ).rejects.toThrow(/wallet_perks_address_check/);
      await expect(
        repo.insertPerk({ campaign: CAMPAIGN_ID, address: a, perkKey: 'priority-rwa', pointsAtGrant: -1 }),
      ).rejects.toThrow(/wallet_perks_points_at_grant_check/);
    });

    it('balancesOfEnrolled lists every enrolled wallet, 0 for one without a ledger row', async () => {
      const rows = await repo.balancesOfEnrolled(CAMPAIGN_ID);
      expect(rows.find((r) => r.address === a)?.balance).toBe(30);
      expect(rows.find((r) => r.address === b)?.balance).toBe(0);
    });

    it('metricsFacts follows the recon §8 definitions (window-bounded vs campaign-scoped)', async () => {
      const after = await repo.metricsFacts(CAMPAIGN_ID, WINDOW);
      // window-bounded on the stated column; endsAt exclusive
      expect(after.walletsRegisteredInWindow).toBe(before.walletsRegisteredInWindow + 1);
      expect(after.walletsProvenInWindow).toBe(before.walletsProvenInWindow + 1);
      expect(after.walletsWithVerifiedActionInWindow).toBe(before.walletsWithVerifiedActionInWindow + 1); // B's withdraw is not awardable
      expect(after.verifiedActionsByKind).toEqual({
        'sdex-swap': before.verifiedActionsByKind['sdex-swap'] + 1,
        'blend-deposit': before.verifiedActionsByKind['blend-deposit'] + 1,
        'blend-withdraw': before.verifiedActionsByKind['blend-withdraw'] + 2,
      });
      // campaign-scoped
      expect(after.walletsEnrolled).toBe(before.walletsEnrolled + 2);
      expect(after.referralsCredited).toBe(before.referralsCredited + 1);
      expect(after.socialClaimsActive).toBe(before.socialClaimsActive + 1);
      expect(after.pointsIssued).toBe(before.pointsIssued + 50);
      expect(after.perksGranted).toEqual({
        'early-access': before.perksGranted['early-access'] + 1,
        'beta-features': before.perksGranted['beta-features'] + 1,
        'priority-rwa': before.perksGranted['priority-rwa'],
      });
      // no window → nothing registered / proven / acted inside it
      const empty = await repo.metricsFacts(CAMPAIGN_ID, { startsAtMs: Date.UTC(2031, 0, 1), endsAtMs: null });
      expect(empty.walletsRegisteredInWindow).toBe(0);
      expect(empty.walletsProvenInWindow).toBe(0);
      expect(empty.walletsWithVerifiedActionInWindow).toBe(0);
      expect(empty.verifiedActionsByKind).toEqual({ 'sdex-swap': 0, 'blend-deposit': 0, 'blend-withdraw': 0 });
    });
  });
});
