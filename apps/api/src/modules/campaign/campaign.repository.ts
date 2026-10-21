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
import { STREAK_DAILY_POINTS, type ActionKind, type PerkKey } from './campaign-rules';
import type { SignatureVariant } from './verify-wallet-signature';
import { listSocialClaims, type SocialClaimRow } from './social-claims.queries';

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

export interface ActionCandidateRow {
  tx_hash: string;
  address: string;
  user_id: string;
  kind: ActionKind;
  meets_min_notional: boolean;
  ledger_closed_at: Date;
}

export interface ReferralRow {
  campaign: number;
  referee_address: string;
  referrer_address: string;
  code: string;
  linked_at: Date;
}

export interface PerkRow {
  perk_key: PerkKey;
  granted_at: Date;
}

/** EP4: the two awardable kinds (withdraws never earn, never pend). */
export type AwardableKind = 'sdex-swap' | 'blend-deposit';
export type PendingByKind = Record<AwardableKind, number>;

/** EP4: one activity-feed row as SQL returns it (tx hash already truncated). */
export interface LedgerActivityRow {
  reason: string;
  points: number;
  multiplier: number;
  counted_day: string | null;
  created_at: Date;
  tx_hash_short: string | null;
}

/**
 * EP3: the raw counts behind GET /v1/campaign/metrics (recon §8 definitions).
 * Every window-bounded figure uses [startsAt, endsAt) on the column named in
 * the metrics boundary string; the campaign-scoped ones ignore the window.
 */
export interface MetricsFacts {
  walletsRegisteredInWindow: number;
  walletsProvenInWindow: number;
  walletsEnrolled: number;
  walletsWithVerifiedActionInWindow: number;
  verifiedActionsByKind: Record<ActionKind, number>;
  referralsCredited: number;
  socialClaimsActive: number;
  pointsIssued: number;
  perksGranted: Record<PerkKey, number>;
}

/** Witness kinds that can earn points (the award job + pending count agree). */
export const AWARDABLE_KINDS: ReadonlyArray<ActionKind> = ['sdex-swap', 'blend-deposit'];

@Injectable()
export class CampaignRepository {
  /** The connection every query runs on: the pool, or a transaction client when bound. */
  db: Db;

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
  // Social tasks (EP2): the SQL lives in social-claims.queries.ts; the writes
  // run inside transaction() from CampaignSocialService. Only the /me read is
  // exposed here (no handle in the row).
  // -------------------------------------------------------------------------

  async listSocialClaims(campaign: number, address: string): Promise<SocialClaimRow[]> {
    return listSocialClaims(this.db, campaign, address);
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
    const byKind = await this.pendingVerificationByKind(campaign, address, window);
    return Object.values(byKind).reduce((sum, n) => sum + n, 0);
  }

  /**
   * EP4: the same pending count split per awardable kind (always both keys,
   * 0 when none). The sum is pendingVerificationCount.
   */
  async pendingVerificationByKind(
    campaign: number,
    address: string,
    window: { startsAtMs: number | null; endsAtMs: number | null },
  ): Promise<PendingByKind> {
    const out: PendingByKind = { 'sdex-swap': 0, 'blend-deposit': 0 };
    if (window.startsAtMs == null) return out;
    const rows = (await this.db.$queryRawUnsafe(
      `select w.kind, count(*)::int as n
         from action_witnesses w
        where lower(w.wallet_address) = lower($1)
          and w.kind = any($2::text[])
          and w.meets_min_notional = true
          and w.ledger_closed_at >= $3::timestamptz
          and ($4::timestamptz is null or w.ledger_closed_at < $4::timestamptz)
          and not exists (
            select 1 from points_ledger l
             where l.campaign = $5 and l.witness_tx_hash = w.tx_hash
          )
        group by w.kind`,
      address,
      [...AWARDABLE_KINDS],
      new Date(window.startsAtMs).toISOString(),
      window.endsAtMs != null ? new Date(window.endsAtMs).toISOString() : null,
      campaign,
    )) as Array<{ kind: AwardableKind; n: number }>;
    for (const r of rows) if (r.kind in out) out[r.kind] = r.n;
    return out;
  }

  // -------------------------------------------------------------------------
  // EP4 reads for the Earn v1.1 hero / actions / activity cards. All derived
  // from points_ledger (sums and counts, nothing stored — rule I).
  // -------------------------------------------------------------------------

  /**
   * Points counted against one UTC day: sum(points) over every row whose
   * counted_day is `day`, adjust rows included (an adjust row only counts
   * toward a day when the founder sets its counted_day). "+N today" in the UI.
   */
  async pointsOn(campaign: number, address: string, day: string): Promise<number> {
    const rows = (await this.db.$queryRawUnsafe(
      `select coalesce(sum(points), 0)::int as n
         from points_ledger
        where campaign = $1 and lower(address) = lower($2) and counted_day = $3::date`,
      campaign,
      address,
      day,
    )) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /** Action awards counted on one UTC day per awardable kind (the daily-cap numerator). */
  async actionsCountedOn(campaign: number, address: string, day: string): Promise<PendingByKind> {
    const out: PendingByKind = { 'sdex-swap': 0, 'blend-deposit': 0 };
    const rows = (await this.db.$queryRawUnsafe(
      `select reason, count(*)::int as n
         from points_ledger
        where campaign = $1 and lower(address) = lower($2)
          and reason like 'action:%' and counted_day = $3::date
        group by reason`,
      campaign,
      address,
      day,
    )) as Array<{ reason: string; n: number }>;
    for (const r of rows) {
      const kind = r.reason.slice('action:'.length) as AwardableKind;
      if (kind in out) out[kind] = r.n;
    }
    return out;
  }

  /**
   * The wallet's most recent ledger rows, newest first. The witness hash is
   * truncated IN SQL to its first 8 characters (action rows only): the
   * activity feed never carries a full tx hash, a handle or another address.
   */
  async recentLedger(campaign: number, address: string, limit: number): Promise<LedgerActivityRow[]> {
    return (await this.db.$queryRawUnsafe(
      `select reason, points, multiplier::float as multiplier, counted_day::text as counted_day, created_at,
              case when reason like 'action:%' then left(witness_tx_hash, 8) else null end as tx_hash_short
         from points_ledger
        where campaign = $1 and lower(address) = lower($2)
        order by created_at desc, id desc
        limit $3`,
      campaign,
      address,
      limit,
    )) as LedgerActivityRow[];
  }
  // -------------------------------------------------------------------------
  // Award job (84-campaign-award.ts): the ONLY writer of action:* and
  // referral:* rows. Serialized by the cron flock, so no row lock (rule H).
  // -------------------------------------------------------------------------

  /**
   * Awardable witnesses of ENROLLED wallets inside the campaign window that
   * have no action ledger row yet, oldest first. Rows below the min notional
   * are included so the job can count the skip; withdraws never are.
   */
  async findActionCandidates(
    campaign: number,
    window: { startsAtMs: number; endsAtMs: number | null },
  ): Promise<ActionCandidateRow[]> {
    return (await this.db.$queryRawUnsafe(
      `select w.tx_hash, e.address, e.user_id, w.kind, w.meets_min_notional, w.ledger_closed_at
         from action_witnesses w
         join campaign_enrollments e
           on e.campaign = $1 and lower(e.address) = lower(w.wallet_address)
        where w.kind = any($2::text[])
          and w.ledger_closed_at >= $3::timestamptz
          and ($4::timestamptz is null or w.ledger_closed_at < $4::timestamptz)
          and not exists (
            select 1 from points_ledger l
             where l.campaign = $1 and l.reason = 'action:' || w.kind and l.witness_tx_hash = w.tx_hash
          )
        order by w.ledger_closed_at asc, w.tx_hash asc`,
      campaign,
      [...AWARDABLE_KINDS],
      new Date(window.startsAtMs).toISOString(),
      window.endsAtMs != null ? new Date(window.endsAtMs).toISOString() : null,
    )) as ActionCandidateRow[];
  }

  /** Existing action awards per (wallet, reason, UTC day): the daily-cap baseline. */
  async countedActionsByDay(campaign: number): Promise<Array<{ address: string; reason: string; day: string; n: number }>> {
    return (await this.db.$queryRawUnsafe(
      `select address, reason, counted_day::text as day, count(*)::int as n
         from points_ledger
        where campaign = $1 and reason like 'action:%' and counted_day is not null
        group by address, reason, counted_day`,
      campaign,
    )) as Array<{ address: string; reason: string; day: string; n: number }>;
  }

  /** Every check-in day of every wallet in the campaign (streak inputs). */
  async checkinDaysByWallet(campaign: number): Promise<Array<{ address: string; day: string }>> {
    return (await this.db.$queryRawUnsafe(
      `select address, day::text as day from wallet_daily_checkins where campaign = $1`,
      campaign,
    )) as Array<{ address: string; day: string }>;
  }

  /** Idempotent: the witness unique index makes a repeat a no-op (returns 0). */
  async insertActionAward(row: {
    campaign: number;
    address: string;
    userId: string | null;
    reason: string;
    basePoints: number;
    multiplier: number;
    points: number;
    witnessTxHash: string;
    countedDay: string;
  }): Promise<number> {
    return this.db.$executeRawUnsafe(
      `insert into points_ledger
         (campaign, address, user_id, reason, base_points, multiplier, points, witness_tx_hash, counted_day)
       values ($1, $2, $3::uuid, $4, $5, $6, $7, $8, $9::date)
       on conflict do nothing`,
      row.campaign,
      row.address,
      row.userId,
      row.reason,
      row.basePoints,
      row.multiplier,
      row.points,
      row.witnessTxHash,
      row.countedDay,
    );
  }

  async findUncreditedReferrals(campaign: number): Promise<ReferralRow[]> {
    return (await this.db.$queryRawUnsafe(
      `select campaign, referee_address, referrer_address, code, linked_at
         from referrals
        where campaign = $1 and credited_at is null
        order by linked_at asc`,
      campaign,
    )) as ReferralRow[];
  }

  /** The referee's earliest awardable, min-notional witness at or after the link. */
  async findRefereeFirstQualifyingWitness(
    refereeAddress: string,
    linkedAt: Date,
  ): Promise<{ tx_hash: string; ledger_closed_at: Date } | null> {
    const rows = (await this.db.$queryRawUnsafe(
      `select tx_hash, ledger_closed_at
         from action_witnesses
        where lower(wallet_address) = lower($1)
          and kind = any($2::text[])
          and meets_min_notional = true
          and ledger_closed_at >= $3::timestamptz
        order by ledger_closed_at asc, tx_hash asc
        limit 1`,
      refereeAddress,
      [...AWARDABLE_KINDS],
      linkedAt.toISOString(),
    )) as Array<{ tx_hash: string; ledger_closed_at: Date }>;
    return rows[0] ?? null;
  }

  /**
   * Credit a referral in ONE transaction: the two ledger rows (both keyed by
   * the referee address) and credited_at/credited_tx_hash on the link. The
   * ledger inserts are on-conflict-do-nothing, so a partial earlier run
   * (rows written, link not marked) converges on the next run.
   */
  async creditReferral(params: {
    campaign: number;
    refereeAddress: string;
    referrerAddress: string;
    txHash: string;
    countedDay: string;
    referrerPoints: number;
    refereePoints: number;
  }): Promise<void> {
    await this.transaction(async (r) => {
      const [referee, referrer] = await Promise.all([
        r.findEnrollment(params.campaign, params.refereeAddress),
        r.findEnrollment(params.campaign, params.referrerAddress),
      ]);
      const insert = (address: string, userId: string | null, reason: string, points: number) =>
        r.db.$executeRawUnsafe(
          `insert into points_ledger
             (campaign, address, user_id, reason, base_points, multiplier, points, referral_referee, counted_day)
           values ($1, $2, $3::uuid, $4, $5, 1, $5, $6, $7::date)
           on conflict do nothing`,
          params.campaign,
          address,
          userId,
          reason,
          points,
          params.refereeAddress,
          params.countedDay,
        );
      await insert(params.referrerAddress, referrer?.user_id ?? null, 'referral:referrer', params.referrerPoints);
      await insert(params.refereeAddress, referee?.user_id ?? null, 'referral:referee', params.refereePoints);
      await r.db.$executeRawUnsafe(
        `update referrals set credited_at = now(), credited_tx_hash = $3
          where campaign = $1 and referee_address = $2 and credited_at is null`,
        params.campaign,
        params.refereeAddress,
        params.txHash,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Perks (EP3): wallet_perks, written ONLY by the award job (step 4), read by
  // /me and the metrics. Insert-only: no code path updates or deletes a row.
  // -------------------------------------------------------------------------

  /** Every enrolled wallet with its live balance (sum(points); 0 when no ledger row). */
  async balancesOfEnrolled(campaign: number): Promise<Array<{ address: string; balance: number }>> {
    return (await this.db.$queryRawUnsafe(
      `select e.address, coalesce(sum(l.points), 0)::int as balance
         from campaign_enrollments e
         left join points_ledger l
           on l.campaign = e.campaign and lower(l.address) = lower(e.address)
        where e.campaign = $1
        group by e.address
        order by e.address asc`,
      campaign,
    )) as Array<{ address: string; balance: number }>;
  }

  /** Idempotent: the primary key makes a repeat a no-op (returns 0). */
  async insertPerk(row: { campaign: number; address: string; perkKey: PerkKey; pointsAtGrant: number }): Promise<number> {
    return this.db.$executeRawUnsafe(
      `insert into wallet_perks (campaign, address, perk_key, points_at_grant)
       values ($1, $2, $3, $4)
       on conflict do nothing`,
      row.campaign,
      row.address,
      row.perkKey,
      row.pointsAtGrant,
    );
  }

  /** One wallet's granted perks, oldest first. */
  async listPerks(campaign: number, address: string): Promise<PerkRow[]> {
    return (await this.db.$queryRawUnsafe(
      `select perk_key, granted_at
         from wallet_perks
        where campaign = $1 and lower(address) = lower($2)
        order by granted_at asc, perk_key asc`,
      campaign,
      address,
    )) as PerkRow[];
  }

  // -------------------------------------------------------------------------
  // Metrics (EP3): counts only, never an address. Read by GET /v1/campaign/metrics.
  // -------------------------------------------------------------------------

  async metricsFacts(
    campaign: number,
    window: { startsAtMs: number; endsAtMs: number | null },
  ): Promise<MetricsFacts> {
    const startsAt = new Date(window.startsAtMs).toISOString();
    const endsAt = window.endsAtMs != null ? new Date(window.endsAtMs).toISOString() : null;
    const one = async (sql: string, ...params: unknown[]): Promise<number> => {
      const rows = (await this.db.$queryRawUnsafe(sql, ...params)) as Array<{ n: number | bigint | null }>;
      return Number(rows[0]?.n ?? 0);
    };
    const [
      walletsRegisteredInWindow,
      walletsProvenInWindow,
      walletsEnrolled,
      walletsWithVerifiedActionInWindow,
      actionsByKind,
      referralsCredited,
      socialClaimsActive,
      pointsIssued,
      perksByKey,
    ] = await Promise.all([
      one(
        `select count(*)::int as n from user_wallets
          where created_at >= $1::timestamptz and ($2::timestamptz is null or created_at < $2::timestamptz)`,
        startsAt,
        endsAt,
      ),
      one(
        `select count(distinct lower(address))::int as n from wallet_ownership_proofs
          where verified_at >= $1::timestamptz and ($2::timestamptz is null or verified_at < $2::timestamptz)`,
        startsAt,
        endsAt,
      ),
      one(`select count(*)::int as n from campaign_enrollments where campaign = $1`, campaign),
      one(
        `select count(distinct lower(wallet_address))::int as n from action_witnesses
          where kind = any($3::text[])
            and ledger_closed_at >= $1::timestamptz
            and ($2::timestamptz is null or ledger_closed_at < $2::timestamptz)`,
        startsAt,
        endsAt,
        [...AWARDABLE_KINDS],
      ),
      this.db.$queryRawUnsafe(
        `select kind, count(*)::int as n from action_witnesses
          where ledger_closed_at >= $1::timestamptz
            and ($2::timestamptz is null or ledger_closed_at < $2::timestamptz)
          group by kind`,
        startsAt,
        endsAt,
      ) as Promise<Array<{ kind: string; n: number }>>,
      one(`select count(*)::int as n from referrals where campaign = $1 and credited_at is not null`, campaign),
      one(`select count(*)::int as n from social_task_claims where campaign = $1 and deleted_at is null`, campaign),
      one(`select coalesce(sum(points), 0)::int as n from points_ledger where campaign = $1 and points > 0`, campaign),
      this.db.$queryRawUnsafe(
        `select perk_key, count(*)::int as n from wallet_perks where campaign = $1 group by perk_key`,
        campaign,
      ) as Promise<Array<{ perk_key: PerkKey; n: number }>>,
    ]);

    const verifiedActionsByKind: Record<ActionKind, number> = { 'sdex-swap': 0, 'blend-deposit': 0, 'blend-withdraw': 0 };
    for (const r of actionsByKind) {
      if (r.kind in verifiedActionsByKind) verifiedActionsByKind[r.kind as ActionKind] = Number(r.n);
    }
    const perksGranted: Record<PerkKey, number> = { 'early-access': 0, 'beta-features': 0, 'priority-rwa': 0 };
    for (const r of perksByKey) {
      if (r.perk_key in perksGranted) perksGranted[r.perk_key] = Number(r.n);
    }

    return {
      walletsRegisteredInWindow,
      walletsProvenInWindow,
      walletsEnrolled,
      walletsWithVerifiedActionInWindow,
      verifiedActionsByKind,
      referralsCredited,
      socialClaimsActive,
      pointsIssued,
      perksGranted,
    };
  }
}
