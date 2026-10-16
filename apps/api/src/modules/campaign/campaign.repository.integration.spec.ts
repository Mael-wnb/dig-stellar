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
import { CAMPAIGN_ID } from './campaign-config';

const RUN = process.env.CAMPAIGN_IT === '1';
const d = RUN ? describe : describe.skip;

d('CampaignRepository (integration, local Postgres)', () => {
  const prisma = new PrismaService();
  const repo = new CampaignRepository(prisma);
  const wallet = Keypair.random().publicKey();
  const otherWallet = Keypair.random().publicKey();
  const userId = randomUUID();

  const cleanup = async () => {
    for (const a of [wallet, otherWallet]) {
      await prisma.$executeRawUnsafe(`delete from points_ledger where lower(address) = lower($1)`, a);
      await prisma.$executeRawUnsafe(`delete from wallet_daily_checkins where address = $1`, a);
      await prisma.$executeRawUnsafe(`delete from campaign_enrollments where lower(address) = lower($1)`, a);
      await prisma.$executeRawUnsafe(`delete from wallet_auth_challenges where address = $1`, a);
    }
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
});
