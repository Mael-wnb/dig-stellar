// apps/api/src/modules/campaign/social-claims.queries.ts
//
// Lot EP (EP2): raw SQL for social_task_claims (v6 + v7 soft delete) and the
// social:* / adjust rows of points_ledger. Plain functions over a connection (the pool or a
// transaction client), so CampaignSocialService composes them inside
// CampaignRepository.transaction() — same style as campaign.repository.ts,
// kept in its own file so EP2 adds files instead of growing EP1's.
//
// Write rule H (campaign.repository.ts header): every claim or delete runs in
// ONE transaction that first locks the wallet's campaign_enrollments row
// (lockEnrollment), then reads, then writes. Rule I: nothing stores a balance.
// handle_normalized never leaves this file except to the decision inside the
// same transaction (socialClaimHandles); listSocialClaims omits it on purpose.
// Delete is SOFT (v7): deleted_at is set and the handle is scrubbed to
// 'deleted'; every read below ignores deleted rows (the partial unique
// indexes do the same), so a task can be claimed again after a delete.

import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import { DELETED_HANDLE, SOCIAL_DELETE_REASON } from './social-claims';

export type Db = PrismaService | Prisma.TransactionClient;

export interface SocialClaimRow {
  id: string;
  campaign: number;
  address: string;
  task_key: string;
  claimed_at: Date;
}

/** H. SELECT … FOR UPDATE on the enrollment row: the per-wallet lock. */
export async function lockEnrollment(
  db: Db,
  campaign: number,
  address: string,
): Promise<{ id: string; address: string; user_id: string } | null> {
  const rows = (await db.$queryRawUnsafe(
    `select id, address, user_id
       from campaign_enrollments
      where campaign = $1 and lower(address) = lower($2)
      for update`,
    campaign,
    address,
  )) as Array<{ id: string; address: string; user_id: string }>;
  return rows[0] ?? null;
}

/** The wallet's ACTIVE claims WITHOUT the handle (what /me lists). */
export async function listSocialClaims(db: Db, campaign: number, address: string): Promise<SocialClaimRow[]> {
  return (await db.$queryRawUnsafe(
    `select id, campaign, address, task_key, claimed_at
       from social_task_claims
      where campaign = $1 and lower(address) = lower($2) and deleted_at is null
      order by claimed_at asc`,
    campaign,
    address,
  )) as SocialClaimRow[];
}

/** Task + handle per existing claim of the wallet — for the decision only, inside the transaction. */
export async function socialClaimHandles(
  db: Db,
  campaign: number,
  address: string,
): Promise<Array<{ task_key: string; handle_normalized: string }>> {
  return (await db.$queryRawUnsafe(
    `select task_key, handle_normalized
       from social_task_claims
      where campaign = $1 and lower(address) = lower($2) and deleted_at is null`,
    campaign,
    address,
  )) as Array<{ task_key: string; handle_normalized: string }>;
}

/** True when ANOTHER wallet already claimed any task with this handle. */
export async function handleUsedByOtherWallet(
  db: Db,
  campaign: number,
  handle: string,
  address: string,
): Promise<boolean> {
  const rows = (await db.$queryRawUnsafe(
    `select 1 as one
       from social_task_claims
      where campaign = $1 and handle_normalized = $2 and lower(address) <> lower($3)
        and deleted_at is null
      limit 1`,
    campaign,
    handle,
    address,
  )) as Array<{ one: number }>;
  return rows.length > 0;
}

/** GROSS social points credited to the wallet on `day` (UTC): deleted claims still count toward the cap. */
export async function socialPointsAwardedOn(db: Db, campaign: number, address: string, day: string): Promise<number> {
  const rows = (await db.$queryRawUnsafe(
    `select coalesce(sum(points), 0)::int as n
       from points_ledger
      where campaign = $1 and lower(address) = lower($2)
        and reason like 'social:%' and counted_day = $3::date`,
    campaign,
    address,
    day,
  )) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

export async function insertSocialClaim(
  db: Db,
  params: { campaign: number; address: string; taskKey: string; handle: string },
): Promise<SocialClaimRow> {
  const rows = (await db.$queryRawUnsafe(
    `insert into social_task_claims (campaign, address, task_key, handle_normalized)
     values ($1, $2, $3, $4)
     returning id, campaign, address, task_key, claimed_at`,
    params.campaign,
    params.address,
    params.taskKey,
    params.handle,
  )) as SocialClaimRow[];
  return rows[0];
}

/** The social:<task> ledger row for a claim (multiplier is always 1 for social). */
export async function insertSocialAward(
  db: Db,
  params: {
    campaign: number;
    address: string;
    userId: string | null;
    reason: string;
    basePoints: number;
    points: number;
    claimId: string;
    day: string;
  },
): Promise<number> {
  const rows = (await db.$queryRawUnsafe(
    `insert into points_ledger
       (campaign, address, user_id, reason, base_points, multiplier, points, social_claim_id, counted_day)
     values ($1, $2, $3::uuid, $4, $5, 1, $6, $7::uuid, $8::date)
     returning id`,
    params.campaign,
    params.address,
    params.userId,
    params.reason,
    params.basePoints,
    params.points,
    params.claimId,
    params.day,
  )) as Array<{ id: bigint | number }>;
  return Number(rows[0].id);
}

/** An ACTIVE claim by id, only if it belongs to `address` (a foreign or deleted id reads as not found). */
export async function findOwnedSocialClaim(
  db: Db,
  campaign: number,
  id: string,
  address: string,
): Promise<SocialClaimRow | null> {
  const rows = (await db.$queryRawUnsafe(
    `select id, campaign, address, task_key, claimed_at
       from social_task_claims
      where campaign = $1 and id = $2::uuid and lower(address) = lower($3) and deleted_at is null
      limit 1`,
    campaign,
    id,
    address,
  )) as SocialClaimRow[];
  return rows[0] ?? null;
}

/** The ledger row that credited a claim (it keeps its social_claim_id after the soft delete). */
export async function findSocialLedgerRow(
  db: Db,
  campaign: number,
  claimId: string,
): Promise<{ id: number; points: number; user_id: string | null } | null> {
  const rows = (await db.$queryRawUnsafe(
    `select id, points, user_id
       from points_ledger
      where campaign = $1 and social_claim_id = $2::uuid and reason like 'social:%'
      limit 1`,
    campaign,
    claimId,
  )) as Array<{ id: bigint | number; points: number; user_id: string | null }>;
  const row = rows[0];
  return row ? { id: Number(row.id), points: row.points, user_id: row.user_id } : null;
}

/** The negative 'adjust:social-delete' row pointing at the credited row (append-only correction). */
export async function insertSocialDeleteAdjust(
  db: Db,
  params: { campaign: number; address: string; userId: string | null; adjustsId: number; points: number },
): Promise<number> {
  const rows = (await db.$queryRawUnsafe(
    `insert into points_ledger
       (campaign, address, user_id, reason, base_points, multiplier, points, adjusts_id)
     values ($1, $2, $3::uuid, $4, $5, 1, $6, $7)
     returning id`,
    params.campaign,
    params.address,
    params.userId,
    SOCIAL_DELETE_REASON,
    Math.abs(params.points),
    -Math.abs(params.points),
    params.adjustsId,
  )) as Array<{ id: bigint | number }>;
  return Number(rows[0].id);
}

/**
 * v7 SOFT delete: deleted_at = now() and the handle scrubbed to 'deleted', in
 * one statement guarded by deleted_at is null (a second call affects 0 rows).
 * The row stays so the credited ledger row keeps its social_claim_id.
 */
export async function softDeleteSocialClaim(db: Db, campaign: number, id: string): Promise<number> {
  return db.$executeRawUnsafe(
    `update social_task_claims
        set deleted_at = now(), handle_normalized = $3
      where campaign = $1 and id = $2::uuid and deleted_at is null`,
    campaign,
    id,
    DELETED_HANDLE,
  );
}
