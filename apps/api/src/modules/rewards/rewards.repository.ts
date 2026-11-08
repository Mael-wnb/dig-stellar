// apps/api/src/modules/rewards/rewards.repository.ts
//
// Lot EP (EP5): raw-SQL access for reward_allocations + reward_claims
// (stellar_v9_rewards.sql). MONEY PATH (docs/security-invariants.md §13).
// Same style as campaign.repository.ts: prisma is a connection, not an ORM.
// Exported from RewardsModule so the award script (84-campaign-award.ts, step
// 5) runs the allocation step through it — allocation ONLY, no payout here.
//
// Two write paths, nothing else:
//   * allocateClosedDays — the award job's step. For every CLOSED UTC day with
//     positive points and no allocation row yet (and past the grace), compute
//     the shares with the PURE allocateDay() and insert them in ONE
//     transaction, on conflict do nothing (the PK is the idempotency key).
//     A day with any row is never re-allocated, so a re-run inserts nothing.
//   * beginClaim / markClaimPaid / markClaimFailed — the claim's three steps.
//     beginClaim runs in ONE transaction that first locks the wallet's
//     campaign_enrollments row (SELECT … FOR UPDATE, rule H of the campaign),
//     re-gathers the DB facts under the lock, runs the PURE claimEligibility()
//     (the service ran it once already, advisory), inserts the 'paying' claim
//     and moves the wallet's 'claimable' allocations to 'paying' with the claim
//     id. Two concurrent claims for one wallet therefore yield exactly one.
//
// Status transitions only move forward (INV-13.3): no UPDATE here ever sets
// 'claimable' back, and no DELETE exists outside the specs' cleanup.
// Amounts travel as 7-decimal strings (numeric(12,7)::text) and are handled as
// stroops (BigInt) — never a float.
// Logging: nothing identifying — counts and day labels only, never an address.

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import {
  ALLOCATION_GRACE_MS,
  isRewardsEnabled,
  rewardsDailyCapXlm,
  rewardsDailyPoolXlm,
  rewardsExcludedAddresses,
} from './rewards-config';
import {
  allocateDay,
  claimEligibility,
  dayIsAllocatable,
  stroopsToXlm,
  xlmToStroops,
  type ClaimFacts,
  type ClaimIneligibleReason,
} from './rewards-rules';

type Db = PrismaService | Prisma.TransactionClient;

export type AllocationStatus = 'claimable' | 'paying' | 'paid' | 'failed';
export type ClaimStatus = 'paying' | 'paid' | 'failed';

/** One allocation row as /me and the claim read it (amounts as 7-decimal strings). */
export interface AllocationRow {
  day: string;
  points_day: number;
  pool_xlm: string;
  cap_xlm: string;
  share_xlm: string;
  status: AllocationStatus;
  claim_id: string | null;
}

export interface PaidClaimRow {
  id: string;
  total_xlm: string;
  tx_hash: string;
  paid_at: Date;
}

export interface AllocationStepSummary {
  /** REWARDS_ENABLED off: nothing read, nothing written. */
  dark: boolean;
  /** Closed days with points that had no allocation yet (grace included). */
  daysPending: number;
  /** Days still inside the post-midnight grace (allocated on a later run). */
  daysWaitingGrace: number;
  daysAllocated: number;
  /** Rows inserted this run (0 on a re-run). */
  allocations: number;
  /** Wallets dropped because excluded, over the allocated days. */
  excludedWallets: number;
  /** Σ share_xlm inserted this run, 7 decimals. */
  distributedXlm: string;
  /** Σ (pool − distributed) over the allocated days, 7 decimals: stays in the treasury. */
  remainderXlm: string;
  poolXlm: number;
  capXlm: number;
}

/** The non-DB facts the service hands to beginClaim (gathered before the lock). */
export interface ClaimContext {
  enabled: boolean;
  proven: boolean;
  excluded: boolean;
  nowMs: number;
  rateLimitMs: number;
  minClaimStroops: bigint;
  /** Treasury native balance read by the payout service; null = not payable. */
  treasuryBalanceStroops: bigint | null;
  reserveStroops: bigint;
}

export type BeginClaimResult =
  | { ok: true; claimId: string; totalStroops: bigint; totalXlm: string; days: string[] }
  | { ok: false; reason: ClaimIneligibleReason };

export interface RewardsOpsCounts {
  allocations: Record<AllocationStatus, number>;
  claims: Record<ClaimStatus, number>;
  /** Σ total_xlm of paid claims, 7 decimals. */
  paidXlm: string;
  /** Σ share_xlm of claimable allocations, 7 decimals (the outstanding liability). */
  claimableXlm: string;
  /** Last allocated day or null. */
  lastAllocatedDay: string | null;
}

@Injectable()
export class RewardsRepository {
  db: Db;

  constructor(private readonly prisma: PrismaService) {
    this.db = prisma;
  }

  private boundTo(tx: Prisma.TransactionClient): RewardsRepository {
    const bound = new RewardsRepository(this.prisma);
    bound.db = tx;
    return bound;
  }

  async transaction<T>(fn: (repo: RewardsRepository) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => fn(this.boundTo(tx)));
  }

  /** Today's UTC day as the database sees it (single source for "today"). */
  async todayUtc(): Promise<string> {
    const rows = (await this.db.$queryRawUnsafe(
      `select (now() at time zone 'utc')::date::text as day`,
    )) as Array<{ day: string }>;
    return rows[0].day;
  }

  // -------------------------------------------------------------------------
  // Allocation (award job step 5)
  // -------------------------------------------------------------------------

  /**
   * Closed UTC days (< today) with at least one positive ledger row and no
   * allocation row yet, oldest first.
   */
  async pendingClosedDays(campaign: number, today: string): Promise<string[]> {
    const rows = (await this.db.$queryRawUnsafe(
      `select distinct l.counted_day::text as day
         from points_ledger l
        where l.campaign = $1
          and l.points > 0
          and l.counted_day is not null
          and l.counted_day < $2::date
          and not exists (
            select 1 from reward_allocations a
             where a.campaign = l.campaign and a.day = l.counted_day
          )
        order by 1 asc`,
      campaign,
      today,
    )) as Array<{ day: string }>;
    return rows.map((r) => r.day);
  }

  /** Σ positive points per ENROLLED wallet on one UTC day (points > 0 only, rule of the brief). */
  async pointsByEnrolledWalletOn(campaign: number, day: string): Promise<Array<{ address: string; points: number }>> {
    return (await this.db.$queryRawUnsafe(
      `select e.address, sum(l.points)::int as points
         from points_ledger l
         join campaign_enrollments e
           on e.campaign = l.campaign and lower(e.address) = lower(l.address)
        where l.campaign = $1 and l.counted_day = $2::date and l.points > 0
        group by e.address
       having sum(l.points) > 0
        order by e.address asc`,
      campaign,
      day,
    )) as Array<{ address: string; points: number }>;
  }

  /**
   * Insert one day's allocations in ONE transaction, on conflict do nothing.
   * Returns the number of rows actually inserted (0 when the day was already
   * allocated by an overlapping run).
   */
  async insertDayAllocations(
    campaign: number,
    day: string,
    rows: ReadonlyArray<{ address: string; pointsDay: number; shareXlm: string }>,
    poolXlm: string,
    capXlm: string,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    return this.transaction(async (r) => {
      let inserted = 0;
      for (const row of rows) {
        inserted += await r.db.$executeRawUnsafe(
          `insert into reward_allocations
             (campaign, day, address, points_day, pool_xlm, cap_xlm, share_xlm, status)
           values ($1, $2::date, $3, $4, $5::numeric, $6::numeric, $7::numeric, 'claimable')
           on conflict do nothing`,
          campaign,
          day,
          row.address,
          row.pointsDay,
          poolXlm,
          capXlm,
          row.shareXlm,
        );
      }
      return inserted;
    });
  }

  /**
   * THE allocation step (84-campaign-award.ts step 5). Reads the env lazily
   * (pool, cap, excluded, kill-switch), allocates every pending closed day past
   * the grace, and logs ONE line per day with counts only.
   */
  async allocateClosedDays(
    campaign: number,
    opts: { nowMs?: number; log?: (line: string) => void } = {},
  ): Promise<AllocationStepSummary> {
    const log = opts.log ?? (() => undefined);
    const poolXlm = rewardsDailyPoolXlm();
    const capXlm = rewardsDailyCapXlm();
    const summary: AllocationStepSummary = {
      dark: false,
      daysPending: 0,
      daysWaitingGrace: 0,
      daysAllocated: 0,
      allocations: 0,
      excludedWallets: 0,
      distributedXlm: '0.0000000',
      remainderXlm: '0.0000000',
      poolXlm,
      capXlm,
    };
    if (!isRewardsEnabled()) {
      summary.dark = true;
      return summary;
    }
    const nowMs = opts.nowMs ?? Date.now();
    const excluded = rewardsExcludedAddresses();
    const today = await this.todayUtc();
    const days = await this.pendingClosedDays(campaign, today);
    summary.daysPending = days.length;

    let distributed = 0n;
    let remainder = 0n;
    for (const day of days) {
      if (!dayIsAllocatable(day, nowMs, ALLOCATION_GRACE_MS)) {
        summary.daysWaitingGrace += 1;
        continue;
      }
      const points = await this.pointsByEnrolledWalletOn(campaign, day);
      const plan = allocateDay({ poolXlm, capXlm, points, excluded });
      summary.excludedWallets += plan.excludedWallets;
      if (plan.allocations.length === 0) {
        // Σ points = 0 for enrolled, non-excluded wallets: nothing to allocate
        // for this day; it stays pending (harmless: re-evaluated each run).
        log(`[campaign-award] rewards day=${day} wallets=${points.length} excluded=${plan.excludedWallets} allocated=0 (no positive share)`);
        continue;
      }
      const inserted = await this.insertDayAllocations(
        campaign,
        day,
        plan.allocations.map((a) => ({ address: a.address, pointsDay: a.pointsDay, shareXlm: a.shareXlm })),
        plan.poolXlm,
        plan.capXlm,
      );
      summary.daysAllocated += 1;
      summary.allocations += inserted;
      if (inserted > 0) {
        distributed += plan.distributedStroops;
        remainder += plan.remainderStroops;
      }
      log(
        `[campaign-award] rewards day=${day} wallets=${points.length} excluded=${plan.excludedWallets} ` +
          `points=${plan.totalPoints} allocated=${inserted} distributed_xlm=${stroopsToXlm(plan.distributedStroops)} ` +
          `remainder_xlm=${stroopsToXlm(plan.remainderStroops)} pool_xlm=${plan.poolXlm} cap_xlm=${plan.capXlm}`,
      );
    }
    summary.distributedXlm = stroopsToXlm(distributed);
    summary.remainderXlm = stroopsToXlm(remainder);
    return summary;
  }

  // -------------------------------------------------------------------------
  // Reads (/me, claim facts)
  // -------------------------------------------------------------------------

  async allocationsByStatus(campaign: number, address: string, status: AllocationStatus): Promise<AllocationRow[]> {
    return (await this.db.$queryRawUnsafe(
      `select day::text as day, points_day, pool_xlm::text as pool_xlm, cap_xlm::text as cap_xlm,
              share_xlm::text as share_xlm, status, claim_id::text as claim_id
         from reward_allocations
        where campaign = $1 and lower(address) = lower($2) and status = $3
        order by day asc`,
      campaign,
      address,
      status,
    )) as AllocationRow[];
  }

  /** Σ share_xlm of the wallet's 'claimable' rows, in stroops. */
  async claimableStroops(campaign: number, address: string): Promise<bigint> {
    const rows = (await this.db.$queryRawUnsafe(
      `select coalesce(sum(share_xlm), 0)::text as total
         from reward_allocations
        where campaign = $1 and lower(address) = lower($2) and status = 'claimable'`,
      campaign,
      address,
    )) as Array<{ total: string }>;
    return xlmToStroops(rows[0]?.total ?? '0');
  }

  async hasPayingAllocation(campaign: number, address: string): Promise<boolean> {
    const rows = (await this.db.$queryRawUnsafe(
      `select 1 as one from reward_allocations
        where campaign = $1 and lower(address) = lower($2) and status = 'paying'
        limit 1`,
      campaign,
      address,
    )) as Array<{ one: number }>;
    return rows.length > 0;
  }

  /** created_at of the wallet's most recent claim (any status), or null. */
  async lastClaimAt(campaign: number, address: string): Promise<Date | null> {
    const rows = (await this.db.$queryRawUnsafe(
      `select created_at from reward_claims
        where campaign = $1 and lower(address) = lower($2)
        order by created_at desc
        limit 1`,
      campaign,
      address,
    )) as Array<{ created_at: Date }>;
    return rows[0]?.created_at ?? null;
  }

  async paidClaims(campaign: number, address: string, limit: number): Promise<PaidClaimRow[]> {
    return (await this.db.$queryRawUnsafe(
      `select id::text as id, total_xlm::text as total_xlm, tx_hash, paid_at
         from reward_claims
        where campaign = $1 and lower(address) = lower($2) and status = 'paid'
        order by paid_at desc
        limit $3`,
      campaign,
      address,
      limit,
    )) as PaidClaimRow[];
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

  async isEnrolled(campaign: number, address: string): Promise<boolean> {
    const rows = (await this.db.$queryRawUnsafe(
      `select 1 as one from campaign_enrollments where campaign = $1 and lower(address) = lower($2) limit 1`,
      campaign,
      address,
    )) as Array<{ one: number }>;
    return rows.length > 0;
  }

  // -------------------------------------------------------------------------
  // Claim (three steps; the service drives them, the payout happens between)
  // -------------------------------------------------------------------------

  /**
   * Step 1: ONE transaction — lock the enrollment row, re-gather the DB facts
   * under the lock, decide with the pure rule, insert the 'paying' claim and
   * move the wallet's 'claimable' allocations to 'paying' with the claim id.
   * The treasury facts come from the caller (a Horizon read never runs inside
   * a DB transaction).
   */
  async beginClaim(campaign: number, address: string, ctx: ClaimContext): Promise<BeginClaimResult> {
    return this.prisma.$transaction(async (tx) => {
      const r = this.boundTo(tx);
      const locked = (await tx.$queryRawUnsafe(
        `select address from campaign_enrollments
          where campaign = $1 and lower(address) = lower($2)
          for update`,
        campaign,
        address,
      )) as Array<{ address: string }>;
      const enrollment = locked[0];

      const [payingInProgress, lastClaimAt, claimableStroops] = enrollment
        ? await Promise.all([
            r.hasPayingAllocation(campaign, address),
            r.lastClaimAt(campaign, address),
            r.claimableStroops(campaign, address),
          ])
        : [false, null, 0n];

      const facts: ClaimFacts = {
        enabled: ctx.enabled,
        proven: ctx.proven,
        enrolled: enrollment != null,
        excluded: ctx.excluded,
        payingInProgress,
        lastClaimAtMs: lastClaimAt ? lastClaimAt.getTime() : null,
        nowMs: ctx.nowMs,
        rateLimitMs: ctx.rateLimitMs,
        claimableStroops,
        minClaimStroops: ctx.minClaimStroops,
        treasuryBalanceStroops: ctx.treasuryBalanceStroops,
        reserveStroops: ctx.reserveStroops,
      };
      const decision = claimEligibility(facts);
      if (!decision.ok) return { ok: false, reason: decision.reason } as const;

      const totalXlm = stroopsToXlm(claimableStroops);
      const inserted = (await tx.$queryRawUnsafe(
        `insert into reward_claims (campaign, address, total_xlm, status)
         values ($1, $2, $3::numeric, 'paying')
         returning id::text as id`,
        campaign,
        enrollment!.address,
        totalXlm,
      )) as Array<{ id: string }>;
      const claimId = inserted[0].id;

      const marked = (await tx.$queryRawUnsafe(
        `update reward_allocations
            set status = 'paying', claim_id = $3::uuid
          where campaign = $1 and lower(address) = lower($2) and status = 'claimable'
          returning day::text as day`,
        campaign,
        address,
        claimId,
      )) as Array<{ day: string }>;

      return { ok: true, claimId, totalStroops: claimableStroops, totalXlm, days: marked.map((m) => m.day) } as const;
    });
  }

  /** Step 2a: the ONE payment succeeded — claim and its allocations become 'paid'. */
  async markClaimPaid(claimId: string, txHash: string): Promise<void> {
    await this.transaction(async (r) => {
      await r.db.$executeRawUnsafe(
        `update reward_claims set status = 'paid', tx_hash = $2, paid_at = now()
          where id = $1::uuid and status = 'paying'`,
        claimId,
        txHash,
      );
      await r.db.$executeRawUnsafe(
        `update reward_allocations set status = 'paid' where claim_id = $1::uuid and status = 'paying'`,
        claimId,
      );
    });
  }

  /** Step 2b: the payment failed (or MAY have paid) — 'failed' until founder review, never retried. */
  async markClaimFailed(claimId: string, reason: string): Promise<void> {
    await this.transaction(async (r) => {
      await r.db.$executeRawUnsafe(
        `update reward_claims set status = 'failed', failure_reason = $2
          where id = $1::uuid and status = 'paying'`,
        claimId,
        reason.slice(0, 500),
      );
      await r.db.$executeRawUnsafe(
        `update reward_allocations set status = 'failed' where claim_id = $1::uuid and status = 'paying'`,
        claimId,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Ops (/v1/ops/metrics rewards block): counts and sums only, never an address
  // -------------------------------------------------------------------------

  async opsCounts(campaign: number): Promise<RewardsOpsCounts> {
    const [alloc, claims, sums] = await Promise.all([
      this.db.$queryRawUnsafe(
        `select status, count(*)::int as n from reward_allocations where campaign = $1 group by status`,
        campaign,
      ) as Promise<Array<{ status: AllocationStatus; n: number }>>,
      this.db.$queryRawUnsafe(
        `select status, count(*)::int as n from reward_claims where campaign = $1 group by status`,
        campaign,
      ) as Promise<Array<{ status: ClaimStatus; n: number }>>,
      this.db.$queryRawUnsafe(
        `select
           (select coalesce(sum(total_xlm), 0)::text from reward_claims where campaign = $1 and status = 'paid') as paid_xlm,
           (select coalesce(sum(share_xlm), 0)::text from reward_allocations where campaign = $1 and status = 'claimable') as claimable_xlm,
           (select max(day)::text from reward_allocations where campaign = $1) as last_day`,
        campaign,
      ) as Promise<Array<{ paid_xlm: string; claimable_xlm: string; last_day: string | null }>>,
    ]);
    const allocations: Record<AllocationStatus, number> = { claimable: 0, paying: 0, paid: 0, failed: 0 };
    for (const a of alloc) if (a.status in allocations) allocations[a.status] = Number(a.n);
    const claimCounts: Record<ClaimStatus, number> = { paying: 0, paid: 0, failed: 0 };
    for (const c of claims) if (c.status in claimCounts) claimCounts[c.status] = Number(c.n);
    return {
      allocations,
      claims: claimCounts,
      paidXlm: stroopsToXlm(xlmToStroops(sums[0]?.paid_xlm ?? '0')),
      claimableXlm: stroopsToXlm(xlmToStroops(sums[0]?.claimable_xlm ?? '0')),
      lastAllocatedDay: sums[0]?.last_day ?? null,
    };
  }
}
