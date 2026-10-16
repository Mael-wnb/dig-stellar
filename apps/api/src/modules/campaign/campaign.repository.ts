// apps/api/src/modules/campaign/campaign.repository.ts
//
// Lot EP (EP1): raw-SQL access for the campaign tables (stellar_v6_campaign.sql).
// Same style as alerts.repository.ts: prisma is a connection, not an ORM
// ($queryRawUnsafe / $executeRawUnsafe with positional params). Exported from
// CampaignModule so the award script (84-campaign-award.ts) reuses it.
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

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { STREAK_DAILY_POINTS } from './campaign-rules';

type Db = PrismaService | Prisma.TransactionClient;

export interface ChallengeRow {
  nonce: string;
  address: string;
  message: string;
  issued_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

export interface EnrollmentRow {
  id: string;
  campaign: number;
  address: string;
  user_id: string;
  referral_code: string;
  referred_by_code: string | null;
  enrolled_at: Date;
}

export type CheckinResult =
  | { ok: true; day: string; points: number; ledgerId: number }
  | { ok: false; reason: 'not-enrolled' | 'already-checked-in' };

@Injectable()
export class CampaignRepository {
  constructor(private readonly prisma: PrismaService) {}

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
    await this.prisma.$executeRawUnsafe(
      `insert into wallet_auth_challenges (nonce, address, message, issued_at, expires_at)
       values ($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
      params.nonce,
      params.address,
      params.message,
      params.issuedAt.toISOString(),
      params.expiresAt.toISOString(),
    );
  }

  /**
   * F. Consume a challenge in ONE atomic statement. Returns the stored message
   * (the text the server rebuilds the verification from) or null when the
   * nonce is unknown, for another address, already used, or expired. The row
   * is burnt whether the subsequent signature check passes or fails.
   */
  async consumeChallenge(nonce: string, address: string): Promise<string | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
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
  // Enrollments
  // -------------------------------------------------------------------------

  async findEnrollment(campaign: number, address: string, db: Db = this.prisma): Promise<EnrollmentRow | null> {
    const rows = (await db.$queryRawUnsafe(
      `select id, campaign, address, user_id, referral_code, referred_by_code, enrolled_at
         from campaign_enrollments
        where campaign = $1 and lower(address) = lower($2)
        limit 1`,
      campaign,
      address,
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
    const rows = (await this.prisma.$queryRawUnsafe(
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
    const rows = (await this.prisma.$queryRawUnsafe(
      `select day::text as day
         from wallet_daily_checkins
        where campaign = $1 and address = $2
        order by day desc`,
      campaign,
      address,
    )) as Array<{ day: string }>;
    return rows.map((r) => r.day);
  }

  // -------------------------------------------------------------------------
  // Balance (I: always a sum, never stored)
  // -------------------------------------------------------------------------

  async balance(campaign: number, address: string): Promise<number> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `select coalesce(sum(points), 0)::int as balance
         from points_ledger
        where campaign = $1 and lower(address) = lower($2)`,
      campaign,
      address,
    )) as Array<{ balance: number }>;
    return rows[0]?.balance ?? 0;
  }
}
