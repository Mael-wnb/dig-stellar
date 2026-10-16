// apps/api/src/modules/campaign/campaign.repository.ts
//
// Lot EP (EP1): raw-SQL access for the campaign tables (stellar_v6_campaign.sql).
// Same style as alerts.repository.ts: prisma is a connection, not an ORM
// ($queryRawUnsafe / $executeRawUnsafe with positional params). Exported from
// CampaignModule so the award script (84-campaign-award.ts) and the wallets
// recovery path reuse it.
//
// ISOLATION: imports nothing from modules/actions, modules/faucet or
// modules/wallets. It reads action_witnesses and user_wallets by SQL only.
//
// Write rules (founder gate 1-bis, 2026-10-16):
//   F. A challenge nonce is consumed by ONE atomic statement — never
//      select-then-update — and is burnt on a failed verify as well.
//   H. Every daily-capped write made through the API (check-in now, social
//      claims in EP2) runs in ONE transaction that first locks the wallet's
//      campaign_enrollments row (SELECT … FOR UPDATE), then counts, then
//      inserts. Action awards are written only by the award job, which is
//      serialized by flock, so they need no lock.
//   I. Balance is always sum(points) over points_ledger; nothing is stored.
//   G. "Day" is (now() at time zone 'utc')::date, never the session time zone.
//
// Transactions: `transaction(fn)` hands `fn` a repository bound to the
// transaction client, so the service composes facts → pure decision → writes
// inside one transaction without the SQL leaking out of this file.

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { STREAK_DAILY_POINTS, type ActionKind } from './campaign-rules';
import type { SignatureVariant } from './verify-wallet-signature';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * True iff the error is a Postgres 23505 unique violation (Prisma surfaces raw
 * failures as PrismaClientKnownRequestError with the PG code in meta.code; the
 * substring checks cover driver drift). Duplicated from the faucet on purpose:
 * the campaign module imports nothing from modules/faucet.
 */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { meta?: { code?: unknown; message?: unknown }; message?: unknown } | null;
  if (e?.meta?.code === '23505') return true;
  const text = `${String(e?.message ?? '')} ${String(e?.meta?.message ?? '')}`;
  return text.includes('23505') || text.includes('duplicate key value violates unique constraint');
}

/**
 * Which unique key a 23505 hit. Postgres reports it as
 * `Key (col, col)=(…) already exists.` (that is what Prisma relays in
 * meta.message); some drivers name the constraint instead. Returns the
 * normalised column list (e.g. 'campaign, referral_code') or the constraint
 * name, or null when neither is present.
 */
export function violatedUniqueKey(err: unknown): string | null {
  const e = err as { meta?: { message?: unknown }; message?: unknown } | null;
  const text = `${String(e?.message ?? '')} ${String(e?.meta?.message ?? '')}`;
  const byKey = text.match(/Key \(([^=]+?)\)=/);
  if (byKey) return byKey[1].replace(/\s+/g, ' ').trim();
  const byName = text.match(/unique constraint "([^"]+)"/);
  return byName?.[1] ?? null;
}

/** The two enrolment unique keys, as violatedUniqueKey reports them. */
export const ENROLLMENT_CODE_KEY = 'campaign, referral_code';
export const ENROLLMENT_WALLET_KEY = 'campaign, lower(address)';

export interface EnrollmentRow {
  id: string;
  campaign: number;
  address: string;
  user_id: string;
  referral_code: string;
  referred_by_code: string | null;
  enrolled_at: Date;
}

export interface ProofRow {
  id: string;
  address: string;
  user_id: string | null;
  provider: string | null;
  nonce: string;
  signature_variant: SignatureVariant;
  verified_at: Date;
  consumed_at: Date | null;
}

export type CheckinResult =
  | { ok: true; day: string; points: number; ledgerId: number }
  | { ok: false; reason: 'not-enrolled' | 'already-checked-in' };

export interface LeaderboardRow {
  address: string;
  points: number;
}

/** Witness kinds that can earn points (the award job + pending count agree). */
export const AWARDABLE_KINDS: ReadonlyArray<ActionKind> = ['sdex-swap', 'blend-deposit'];

@Injectable()
export class CampaignRepository {
  /** The connection every query runs on: the pool, or a transaction client when bound. */
  private db: Db;

  constructor(private readonly prisma: PrismaService) {
    this.db = prisma;
  }

  /** A copy of this repository whose queries run on `tx` (never injected: built by transaction()). */
  private boundTo(tx: Prisma.TransactionClient): CampaignRepository {
    const bound = new CampaignRepository(this.prisma);
    bound.db = tx;
    return bound;
  }

  /** Run `fn` inside one DB transaction with a repository bound to it. */
  async transaction<T>(fn: (repo: CampaignRepository) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => fn(this.boundTo(tx)));
  }

  // -------------------------------------------------------------------------
  // Challenges (ownership proof)
  // -------------------------------------------------------------------------

  async createChallenge(params: {
    nonce: string;
    address: string;
    message: string;
    issuedAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.$executeRawUnsafe(
      `insert into wallet_auth_challenges (nonce, address, message, issued_at, expires_at)
       values ($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
      params.nonce,
      params.address,
      params.message,
      params.issuedAt.toISOString(),
      params.expiresAt.toISOString(),
    );
  }

  /** Bounded housekeeping, run on every challenge issue: drop challenges expired > 1 day ago. */
  async deleteStaleChallenges(): Promise<number> {
    return this.db.$executeRawUnsafe(
      `delete from wallet_auth_challenges where expires_at < now() - interval '1 day'`,
    );
  }

  /**
   * F. Consume a challenge in ONE atomic statement. Returns the stored message
   * (the text the server rebuilds the verification from) or null when the
   * nonce is unknown, for another address, already used, or expired. The row
   * is burnt whether the subsequent signature check passes or fails.
   */
  async consumeChallenge(nonce: string, address: string): Promise<string | null> {
    const rows = (await this.db.$queryRawUnsafe(
      `update wallet_auth_challenges
          set used_at = now()
        where nonce = $1
          and address = $2
          and used_at is null
          and expires_at > now()
       returning message`,
      nonce,
      address,
    )) as Array<{ message: string }>;
    return rows[0]?.message ?? null;
  }

  // -------------------------------------------------------------------------
  // Ownership proofs
  // -------------------------------------------------------------------------

  /** Bound proof for (address, userId): insert, or refresh the existing row (partial unique index). */
  async upsertBoundProof(params: {
    address: string;
    userId: string;
    provider: string | null;
    nonce: string;
    variant: SignatureVariant;
  }): Promise<ProofRow> {
    const rows = (await this.db.$queryRawUnsafe(
      `insert into wallet_ownership_proofs (address, user_id, provider, nonce, signature_variant)
       values ($1, $2::uuid, $3, $4, $5)
       on conflict (lower(address), user_id) where user_id is not null
       do update set verified_at = now(), nonce = excluded.nonce, provider = excluded.provider,
                     signature_variant = excluded.signature_variant, consumed_at = null
       returning id, address, user_id, provider, nonce, signature_variant, verified_at, consumed_at`,
      params.address,
      params.userId,
      params.provider,
      params.nonce,
      params.variant,
    )) as ProofRow[];
    return rows[0];
  }

  /** Unbound proof (no session): consumed once by wallet-connect recovery. */
  async insertUnboundProof(params: {
    address: string;
    provider: string | null;
    nonce: string;
    variant: SignatureVariant;
  }): Promise<ProofRow> {
    const rows = (await this.db.$queryRawUnsafe(
      `insert into wallet_ownership_proofs (address, user_id, provider, nonce, signature_variant)
       values ($1, null, $2, $3, $4)
       returning id, address, user_id, provider, nonce, signature_variant, verified_at, consumed_at`,
      params.address,
      params.provider,
      params.nonce,
      params.variant,
    )) as ProofRow[];
    return rows[0];
  }

  async hasBoundProof(address: string, userId: string): Promise<boolean> {
    const rows = (await this.db.$queryRawUnsafe(
      `select 1 as one from wallet_ownership_proofs
        where lower(address) = lower($1) and user_id = $2::uuid
        limit 1`,
      address,
      userId,
    )) as Array<{ one: number }>;
    return rows.length > 0;
  }

  /**
   * Wallet-connect recovery (Gate 2, step 2): consume the freshest UNBOUND
   * proof for the address, binding it to `userId`, in ONE atomic statement.
   * Returns the consumed row or null when none is fresh and unconsumed.
   */
  async consumeUnboundProof(address: string, userId: string, maxAgeSeconds: number): Promise<ProofRow | null> {
    const rows = (await this.db.$queryRawUnsafe(
      `update wallet_ownership_proofs p
          set consumed_at = now(), user_id = $2::uuid
        where p.id = (
          select id from wallet_ownership_proofs
           where lower(address) = lower($1)
             and user_id is null
             and consumed_at is null
             and verified_at >= now() - ($3::int * interval '1 second')
           order by verified_at desc
           limit 1
           for update skip locked
        )
       returning id, address, user_id, provider, nonce, signature_variant, verified_at, consumed_at`,
      address,
      userId,
      maxAgeSeconds,
    )) as ProofRow[];
    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // Enrollments
  // -------------------------------------------------------------------------

  async findEnrollment(campaign: number, address: string): Promise<EnrollmentRow | null> {
    const rows = (await this.db.$queryRawUnsafe(
      `select id, campaign, address, user_id, referral_code, referred_by_code, enrolled_at
         from campaign_enrollments
        where campaign = $1 and lower(address) = lower($2)
        limit 1`,
      campaign,
      address,
    )) as EnrollmentRow[];
    return rows[0] ?? null;
  }

  async findEnrollmentByCode(campaign: number, code: string): Promise<EnrollmentRow | null> {
    const rows = (await this.db.$queryRawUnsafe(
      `select id, campaign, address, user_id, referral_code, referred_by_code, enrolled_at
         from campaign_enrollments
        where campaign = $1 and referral_code = $2
        limit 1`,
      campaign,
      code,
    )) as EnrollmentRow[];
    return rows[0] ?? null;
  }

  async insertEnrollment(params: {
    campaign: number;
    address: string;
    userId: string;
    referralCode: string;
    referredByCode: string | null;
  }): Promise<EnrollmentRow> {
    const rows = (await this.db.$queryRawUnsafe(
      `insert into campaign_enrollments (campaign, address, user_id, referral_code, referred_by_code)
       values ($1, $2, $3::uuid, $4, $5)
       returning id, campaign, address, user_id, referral_code, referred_by_code, enrolled_at`,
      params.campaign,
      params.address,
      params.userId,
      params.referralCode,
      params.referredByCode,
    )) as EnrollmentRow[];
    return rows[0];
  }

  /**
   * Insert with ONE retry on a referral-code collision, inside the enclosing
   * transaction via a savepoint (a failed statement would otherwise abort the
   * whole transaction). Any other unique violation (a concurrent enrolment of
   * the same wallet) propagates to the caller, which maps it by key columns.
   */
  async insertEnrollmentWithCodeRetry(
    params: { campaign: number; address: string; userId: string; referredByCode: string | null },
    nextCode: () => string,
  ): Promise<EnrollmentRow> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.db.$executeRawUnsafe('savepoint enroll_code');
      try {
        const row = await this.insertEnrollment({ ...params, referralCode: nextCode() });
        await this.db.$executeRawUnsafe('release savepoint enroll_code');
        return row;
      } catch (err) {
        await this.db.$executeRawUnsafe('rollback to savepoint enroll_code');
        const collision = isUniqueViolation(err) && violatedUniqueKey(err) === ENROLLMENT_CODE_KEY;
        if (!collision || attempt === 1) throw err;
      }
    }
    throw new Error('unreachable');
  }

  // -------------------------------------------------------------------------
  // Referrals
  // -------------------------------------------------------------------------

  async insertReferral(params: {
    campaign: number;
    refereeAddress: string;
    referrerAddress: string;
    code: string;
  }): Promise<void> {
    await this.db.$executeRawUnsafe(
      `insert into referrals (campaign, referee_address, referrer_address, code)
       values ($1, $2, $3, $4)`,
      params.campaign,
      params.refereeAddress,
      params.referrerAddress,
      params.code,
    );
  }

  /** The code this wallet was referred with, if any (never the referrer's address). */
  async referredByCode(campaign: number, refereeAddress: string): Promise<string | null> {
    const rows = (await this.db.$queryRawUnsafe(
      `select code from referrals where campaign = $1 and referee_address = $2 limit 1`,
      campaign,
      refereeAddress,
    )) as Array<{ code: string }>;
    return rows[0]?.code ?? null;
  }

  // -------------------------------------------------------------------------
  // Daily check-in (H: lock → count → insert, one transaction)
  // -------------------------------------------------------------------------

  /**
   * Record today's (UTC) check-in for an enrolled wallet and append its
   * streak:daily ledger row. Serialized per wallet by SELECT … FOR UPDATE on
   * the enrollment row, so two concurrent calls for the same wallet yield
   * exactly one check-in. The PK (campaign, address, day) and the partial
   * unique index on the ledger are the backstop, never the mechanism.
   */
  async checkinToday(campaign: number, address: string): Promise<CheckinResult> {
    return this.prisma.$transaction(async (tx) => {
      const locked = (await tx.$queryRawUnsafe(
        `select id, address, user_id
           from campaign_enrollments
          where campaign = $1 and lower(address) = lower($2)
          for update`,
        campaign,
        address,
      )) as Array<{ id: string; address: string; user_id: string }>;
      const enrollment = locked[0];
      if (!enrollment) return { ok: false, reason: 'not-enrolled' } as const;

      const today = (await tx.$queryRawUnsafe(
        `select (now() at time zone 'utc')::date::text as day`,
      )) as Array<{ day: string }>;
      const day = today[0].day;

      const existing = (await tx.$queryRawUnsafe(
        `select count(*)::int as n
           from wallet_daily_checkins
          where campaign = $1 and address = $2 and day = $3::date`,
        campaign,
        enrollment.address,
        day,
      )) as Array<{ n: number }>;
      if (existing[0].n > 0) return { ok: false, reason: 'already-checked-in' } as const;

      await tx.$executeRawUnsafe(
        `insert into wallet_daily_checkins (campaign, address, day) values ($1, $2, $3::date)`,
        campaign,
        enrollment.address,
        day,
      );

      const ledger = (await tx.$queryRawUnsafe(
        `insert into points_ledger
           (campaign, address, user_id, reason, base_points, multiplier, points, checkin_day, counted_day)
         values ($1, $2, $3::uuid, 'streak:daily', $4, 1, $4, $5::date, $5::date)
         returning id`,
        campaign,
        enrollment.address,
        enrollment.user_id,
        STREAK_DAILY_POINTS,
        day,
      )) as Array<{ id: bigint | number }>;

      return { ok: true, day, points: STREAK_DAILY_POINTS, ledgerId: Number(ledger[0].id) } as const;
    });
  }

  /** All check-in days (UTC, 'YYYY-MM-DD') for a wallet, newest first. */
  async checkinDays(campaign: number, address: string): Promise<string[]> {
    const rows = (await this.db.$queryRawUnsafe(
      `select day::text as day
         from wallet_daily_checkins
        where campaign = $1 and address = $2
        order by day desc`,
      campaign,
      address,
    )) as Array<{ day: string }>;
    return rows.map((r) => r.day);
  }

  /** Today's UTC day as the database sees it (single source for "today"). */
  async todayUtc(): Promise<string> {
    const rows = (await this.db.$queryRawUnsafe(
      `select (now() at time zone 'utc')::date::text as day`,
    )) as Array<{ day: string }>;
    return rows[0].day;
  }

  // -------------------------------------------------------------------------
  // Balance / leaderboard (I: always a sum, never stored)
  // -------------------------------------------------------------------------

  async balance(campaign: number, address: string): Promise<number> {
    const rows = (await this.db.$queryRawUnsafe(
      `select coalesce(sum(points), 0)::int as balance
         from points_ledger
        where campaign = $1 and lower(address) = lower($2)`,
      campaign,
      address,
    )) as Array<{ balance: number }>;
    return rows[0]?.balance ?? 0;
  }

  async leaderboard(campaign: number, limit: number): Promise<LeaderboardRow[]> {
    return (await this.db.$queryRawUnsafe(
      `select address, sum(points)::int as points
         from points_ledger
        where campaign = $1
        group by address
       having sum(points) > 0
        order by sum(points) desc, address asc
        limit $2`,
      campaign,
      limit,
    )) as LeaderboardRow[];
  }

  async rankOf(campaign: number, address: string): Promise<{ rank: number; points: number } | null> {
    const rows = (await this.db.$queryRawUnsafe(
      `select rank, points from (
         select address, sum(points)::int as points,
                rank() over (order by sum(points) desc, address asc)::int as rank
           from points_ledger
          where campaign = $1
          group by address
         having sum(points) > 0
       ) ranked
       where lower(address) = lower($2)`,
      campaign,
      address,
    )) as Array<{ rank: number; points: number }>;
    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // Witnesses (read-only view of action_witnesses, the on-chain source)
  // -------------------------------------------------------------------------

  /**
   * Awardable witnesses in the campaign window for a wallet that have no
   * action ledger row yet ("pending verification" in the UI). Withdraws are
   * never awardable so they are not pending. Known limit (EP1): a witness
   * skipped by a daily cap stays in this count until the ledger learns to
   * record skips (EP2 candidate).
   */
  async pendingVerificationCount(
    campaign: number,
    address: string,
    window: { startsAtMs: number | null; endsAtMs: number | null },
  ): Promise<number> {
    if (window.startsAtMs == null) return 0;
    const rows = (await this.db.$queryRawUnsafe(
      `select count(*)::int as n
         from action_witnesses w
        where lower(w.wallet_address) = lower($1)
          and w.kind = any($2::text[])
          and w.meets_min_notional = true
          and w.ledger_closed_at >= $3::timestamptz
          and ($4::timestamptz is null or w.ledger_closed_at < $4::timestamptz)
          and not exists (
            select 1 from points_ledger l
             where l.campaign = $5 and l.witness_tx_hash = w.tx_hash
          )`,
      address,
      [...AWARDABLE_KINDS],
      new Date(window.startsAtMs).toISOString(),
      window.endsAtMs != null ? new Date(window.endsAtMs).toISOString() : null,
      campaign,
    )) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }
}
