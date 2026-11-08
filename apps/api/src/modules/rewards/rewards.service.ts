// apps/api/src/modules/rewards/rewards.service.ts
//
// Lot EP (EP5): the rewards claim orchestration. MONEY PATH
// (docs/security-invariants.md §13). Gathers the facts (repository + treasury
// balance), runs the ONE pure decision (rewards-rules.ts claimEligibility) —
// once advisory, once again under the enrollment row lock inside
// RewardsRepository.beginClaim — then drives ONE payout for ONE claim and
// records the outcome. Nothing here allocates (the award job does) and
// nothing here reads the secret (rewards-payout.service.ts does).
//
// Concurrency model (faucet convention): every claim runs through ONE
// in-process promise chain — payouts are strictly serial (the treasury's
// sequence number would make parallel submits fail anyway). The API runs as a
// single pm2 process (Lot S); the per-wallet row lock + the forward-only
// statuses remain the DB backstop.
//
// Payment discipline: exactly one attempt — NEVER auto-retry a payment (an
// ambiguous failure may still have paid); a failed claim stays 'failed' with
// its allocations until founder review (docs/runbooks.md "Rewards treasury").
//
// Logging: counts, claim ids and amounts only — never an address, never a tx
// hash, never anything about the key.

import { Injectable } from '@nestjs/common';
import { CAMPAIGN_ID } from '../campaign/campaign-config';
import {
  CLAIM_RATE_LIMIT_MS,
  TREASURY_RESERVE_XLM,
  rewardsExcludedAddresses,
  rewardsNetwork,
  rewardsPublicRules,
  type RewardsNetwork,
  type RewardsPublicRules,
} from './rewards-config';
import { RewardsPayoutError, RewardsPayoutService } from './rewards-payout.service';
import { RewardsRepository, type RewardsOpsCounts } from './rewards.repository';
import {
  claimEligibility,
  nextUtcMidnightIso,
  stroopsToNumber,
  xlmToStroops,
  type ClaimIneligibleReason,
} from './rewards-rules';

/** Paid claims listed on /me. */
export const PAID_CLAIMS_LIMIT = 20;

/** Stands in for the treasury in the ADVISORY pass so every other reason is judged first (one Horizon read, only when needed). */
const TREASURY_NOT_YET_READ = 1n << 62n;

export interface RewardsMePayload {
  campaign: number;
  enabled: boolean;
  address: string;
  /** Σ 'claimable' allocations, XLM (7 decimals). */
  claimableXlm: number;
  pendingDays: Array<{ day: string; xlm: number; pointsDay: number; poolXlm: number }>;
  paid: Array<{ claimId: string; xlm: number; txHash: string; paidAt: string }>;
  /** When today's UTC day closes (its allocation follows on the award job's next ticks). */
  nextCloseAt: string;
  minClaimXlm: number;
}

export type RewardsClaimPayload =
  | { claimed: true; status: 'paid'; claimId: string; xlm: number; txHash: string; days: string[] }
  | { claimed: false; status: 'failed'; reason: 'payout-failed'; claimId: string }
  | { claimed: false; reason: ClaimIneligibleReason };

export interface RewardsOpsSnapshot extends RewardsOpsCounts {
  enabled: boolean;
  network: RewardsNetwork;
  campaign: number;
  dailyPoolXlm: number;
  dailyCapXlm: number;
  minClaimXlm: number;
  /** Treasury NATIVE balance — only queried while enabled (a dark deploy stays dark); never the address. */
  treasuryBalanceXlm: number | null;
  reserveXlm: number;
}

@Injectable()
export class RewardsService {
  constructor(
    private readonly repo: RewardsRepository,
    private readonly payout: RewardsPayoutService,
  ) {}

  /** The serial claim queue. Never rejects (each link swallows into its result). */
  private chain: Promise<unknown> = Promise.resolve();

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  rules(): RewardsPublicRules {
    return rewardsPublicRules();
  }

  // --- GET /v1/campaign/rewards/me ------------------------------------------

  async me(params: { address: string; userId: string }, now: number = Date.now()): Promise<RewardsMePayload> {
    const rules = rewardsPublicRules();
    const base = {
      campaign: CAMPAIGN_ID,
      enabled: rules.enabled,
      address: params.address,
      nextCloseAt: nextUtcMidnightIso(now),
      minClaimXlm: rules.minClaimXlm,
    };
    // Dark: nothing is claimable and nothing is listed — the web hides the surface.
    if (!rules.enabled) return { ...base, claimableXlm: 0, pendingDays: [], paid: [] };

    const [claimable, paid] = await Promise.all([
      this.repo.allocationsByStatus(CAMPAIGN_ID, params.address, 'claimable'),
      this.repo.paidClaims(CAMPAIGN_ID, params.address, PAID_CLAIMS_LIMIT),
    ]);
    const total = claimable.reduce((sum, r) => sum + xlmToStroops(r.share_xlm), 0n);
    return {
      ...base,
      claimableXlm: stroopsToNumber(total),
      pendingDays: claimable.map((r) => ({
        day: r.day,
        xlm: stroopsToNumber(xlmToStroops(r.share_xlm)),
        pointsDay: r.points_day,
        poolXlm: stroopsToNumber(xlmToStroops(r.pool_xlm)),
      })),
      paid: paid.map((p) => ({
        claimId: p.id,
        xlm: stroopsToNumber(xlmToStroops(p.total_xlm)),
        txHash: p.tx_hash,
        paidAt: p.paid_at.toISOString(),
      })),
    };
  }

  // --- POST /v1/campaign/rewards/claim --------------------------------------

  claim(params: { address: string; userId: string }, now: number = Date.now()): Promise<RewardsClaimPayload> {
    // The WHOLE claim (facts → lock → payout → record) is serialized.
    return this.serialize(() => this.claimInner(params, now));
  }

  private async claimInner(params: { address: string; userId: string }, now: number): Promise<RewardsClaimPayload> {
    const rules = rewardsPublicRules();
    const network = rewardsNetwork();
    const excluded = rewardsExcludedAddresses().has(params.address.toLowerCase());
    const minClaimStroops = xlmToStroops(rules.minClaimXlm);
    const reserveStroops = xlmToStroops(TREASURY_RESERVE_XLM);

    // Advisory pass without the lock and without Horizon: refuse cheaply.
    const [proven, enrolled, payingInProgress, lastClaimAt, claimableStroops] = await Promise.all([
      this.repo.hasBoundProof(params.address, params.userId),
      this.repo.isEnrolled(CAMPAIGN_ID, params.address),
      this.repo.hasPayingAllocation(CAMPAIGN_ID, params.address),
      this.repo.lastClaimAt(CAMPAIGN_ID, params.address),
      this.repo.claimableStroops(CAMPAIGN_ID, params.address),
    ]);
    const pre = claimEligibility({
      enabled: rules.enabled,
      proven,
      enrolled,
      excluded,
      payingInProgress,
      lastClaimAtMs: lastClaimAt ? lastClaimAt.getTime() : null,
      nowMs: now,
      rateLimitMs: CLAIM_RATE_LIMIT_MS,
      claimableStroops,
      minClaimStroops,
      treasuryBalanceStroops: TREASURY_NOT_YET_READ,
      reserveStroops,
    });
    if (!pre.ok) return { claimed: false, reason: pre.reason };

    // Treasury guard: one Horizon read, only now. Null (no key / unreachable /
    // unfunded) = not payable; the decision under the lock applies the reserve.
    const balance = await this.payout.treasuryBalanceXlm(network);
    const treasuryBalanceStroops = balance == null ? null : xlmToStroops(balance);

    const begun = await this.repo.beginClaim(CAMPAIGN_ID, params.address, {
      enabled: rules.enabled,
      proven,
      excluded,
      nowMs: now,
      rateLimitMs: CLAIM_RATE_LIMIT_MS,
      minClaimStroops,
      treasuryBalanceStroops,
      reserveStroops,
    });
    if (!begun.ok) return { claimed: false, reason: begun.reason };

    // Pay. Exactly one attempt for exactly this claim — NEVER auto-retry.
    try {
      const { txHash } = await this.payout.pay({
        network,
        destination: params.address,
        amountXlm: begun.totalXlm,
        claimId: begun.claimId,
      });
      await this.repo.markClaimPaid(begun.claimId, txHash);
      console.log(`[rewards] claim ${begun.claimId} paid xlm=${begun.totalXlm} days=${begun.days.length}`);
      return {
        claimed: true,
        status: 'paid',
        claimId: begun.claimId,
        xlm: stroopsToNumber(begun.totalStroops),
        txHash,
        days: begun.days,
      };
    } catch (err) {
      const reason = err instanceof RewardsPayoutError ? err.reason : 'payout-error';
      await this.repo.markClaimFailed(begun.claimId, reason);
      console.warn(`[rewards] claim ${begun.claimId} FAILED xlm=${begun.totalXlm}: ${reason}`);
      return { claimed: false, status: 'failed', reason: 'payout-failed', claimId: begun.claimId };
    }
  }

  // --- /v1/ops/metrics rewards block ------------------------------------------

  /** Drain visibility: counts, sums and the treasury balance — never the address, never anything about the key. */
  async getOpsSnapshot(): Promise<RewardsOpsSnapshot> {
    const rules = rewardsPublicRules();
    const network = rewardsNetwork();
    const counts = await this.repo.opsCounts(CAMPAIGN_ID);
    return {
      enabled: rules.enabled,
      network,
      campaign: CAMPAIGN_ID,
      dailyPoolXlm: rules.dailyPoolXlm,
      dailyCapXlm: rules.dailyCapXlm,
      minClaimXlm: rules.minClaimXlm,
      ...counts,
      treasuryBalanceXlm: rules.enabled ? await this.payout.treasuryBalanceXlm(network) : null,
      reserveXlm: TREASURY_RESERVE_XLM,
    };
  }
}
