// apps/api/src/modules/faucet/faucet.service.ts
//
// R2 (Lot R — T3-D2): claims orchestration. Gathers the facts (DB + treasury),
// runs the ONE pure decision procedure (faucet-eligibility.ts) for both the
// eligibility read and the claim write, and drives the serial payout.
//
// Concurrency model: every claim runs through ONE in-process promise chain —
// payouts are strictly serial by design (the hot wallet's sequence number
// would make parallel submits fail anyway). The API runs as a single pm2
// process (Lot S); if that ever changes, the DB unique indexes on
// faucet_claims remain the hard backstop against double-pay per wallet/user.
//
// This module imports NOTHING from the user action paths (modules/actions/**)
// — it reads the witness table, never the witness code.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import {
  isFaucetEnabled,
  faucetNetwork,
  faucetRewardXlm,
  faucetMaxClaims,
  faucetHourlyClaimCap,
  faucetMinNotionalXlm,
  type FaucetNetwork,
} from './faucet-config';
import {
  campaignState,
  walletEligibility,
  type CampaignFacts,
  type PriorClaim,
  type WitnessState,
  type IneligibleReason,
} from './faucet-eligibility';
import { FaucetPayoutService, PayoutError } from './faucet-payout.service';

export interface CampaignPayload {
  active: boolean;
  remainingClaims: number;
  rewardXlm: number;
  network: FaucetNetwork;
  minNotionalXlm: number;
}

export interface EligibilityPayload {
  campaign: CampaignPayload;
  wallet?: {
    address: string;
    eligible: boolean;
    reason?: IneligibleReason;
    /** Present when a claim already exists — feeds R3's paid/failed states. */
    claim?: { status: string; payoutTxHash: string | null };
  };
}

export type ClaimPayload =
  | { claimed: true; status: 'paid'; payoutTxHash: string; rewardXlm: number }
  | { claimed: false; status: 'failed'; reason: 'payout-failed' }
  | { claimed: false; reason: IneligibleReason | 'claim-error' };

type CountsRow = {
  counted: unknown;
  last_hour: unknown;
  pending: unknown;
  paid: unknown;
  failed: unknown;
  paid_24h: unknown;
};
type WitnessRow = { tx_hash: string; user_id: string; meets_min_notional: boolean };
type ClaimRow = { status: string; payout_tx_hash: string | null };
type InsertedRow = { id: string };

function toInt(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
}

/**
 * True iff the error is a Postgres 23505 unique violation. Prisma surfaces raw
 * query failures as PrismaClientKnownRequestError with the PG code in
 * `meta.code`; the message-substring checks cover driver/version drift.
 * Exported for the unit spec (money path: a DB outage must never be read as
 * "already claimed").
 */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { meta?: { code?: unknown; message?: unknown }; message?: unknown } | null;
  if (e?.meta?.code === '23505') return true;
  const text = `${String(e?.message ?? '')} ${String(e?.meta?.message ?? '')}`;
  return text.includes('23505') || text.includes('duplicate key value violates unique constraint');
}

@Injectable()
export class FaucetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payout: FaucetPayoutService,
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

  // --- Eligibility (GET) ----------------------------------------------------

  async getEligibility(wallet?: string): Promise<EligibilityPayload> {
    const network = faucetNetwork();
    const facts = await this.campaignFacts(network);
    const campaign: CampaignPayload = {
      ...campaignState(facts),
      rewardXlm: faucetRewardXlm(),
      network,
      minNotionalXlm: faucetMinNotionalXlm(),
    };
    if (!wallet) return { campaign };

    const { witnessState, priorClaim } = await this.walletFacts(wallet, network);
    // Treasury is checked LAST and only when everything else passes — the
    // pure fn still requires the field, so pass a sentinel that cannot flip
    // the outcome when an earlier check already failed.
    const preTreasury = walletEligibility({
      ...facts,
      witnessState,
      priorClaim,
      treasurySpendableXlm: Number.POSITIVE_INFINITY,
      rewardXlm: campaign.rewardXlm,
    });
    const result = preTreasury.eligible
      ? walletEligibility({
          ...facts,
          witnessState,
          priorClaim,
          treasurySpendableXlm: await this.payout.treasurySpendableXlm(network),
          rewardXlm: campaign.rewardXlm,
        })
      : preTreasury;

    return {
      campaign,
      wallet: {
        address: wallet,
        eligible: result.eligible,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(priorClaim
          ? { claim: { status: priorClaim.status, payoutTxHash: priorClaim.payoutTxHash } }
          : {}),
      },
    };
  }

  // --- Claim (POST) ---------------------------------------------------------

  claim(wallet: string): Promise<ClaimPayload> {
    // The WHOLE claim (re-check → insert → payout → record) is serialized, so
    // two concurrent claims can never interleave between re-check and insert.
    return this.serialize(() => this.claimInner(wallet));
  }

  private async claimInner(wallet: string): Promise<ClaimPayload> {
    const network = faucetNetwork();
    const rewardXlm = faucetRewardXlm();

    // Full server-side re-check — the GET response is advisory, THIS decides.
    const facts = await this.campaignFacts(network);
    const { witness, witnessState, priorClaim } = await this.walletFacts(wallet, network);
    const result = walletEligibility({
      ...facts,
      witnessState,
      priorClaim,
      treasurySpendableXlm: await this.payout.treasurySpendableXlm(network),
      rewardXlm,
    });
    if (!result.eligible || !witness) {
      return { claimed: false, reason: result.reason ?? 'no-qualifying-witness' };
    }

    // An ops mistake (missing key) must not consume the wallet's one claim
    // slot — refuse BEFORE inserting anything.
    if (!this.payout.keyAvailable()) {
      return { claimed: false, reason: 'treasury-unavailable' };
    }

    // Insert the pending row. The unique indexes (wallet, user, witness) are
    // the hard guarantee — a 23505 violation means a concurrent/prior claim
    // won. ANY OTHER error (e.g. a DB outage) must not masquerade as
    // 'already-claimed': log it and return a distinct honest reason.
    let claimId: string;
    try {
      const rows = (await this.prisma.$queryRawUnsafe(
        `insert into faucet_claims
           (wallet_address, user_id, witness_tx_hash, network, status, reward_xlm)
         values ($1, $2::uuid, $3, $4, 'pending', $5)
         returning id::text as id`,
        wallet,
        witness.user_id,
        witness.tx_hash,
        network,
        rewardXlm,
      )) as InsertedRow[];
      claimId = rows[0].id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { claimed: false, reason: 'already-claimed' };
      }
      console.error(
        `[faucet] claim insert failed (NOT a unique violation): ${err instanceof Error ? err.message : String(err)}`,
      );
      return { claimed: false, reason: 'claim-error' };
    }

    // Pay. Exactly one attempt — NEVER auto-retry a payment (an ambiguous
    // failure may still have paid); a failed row blocks until founder review.
    try {
      const { payoutTxHash } = await this.payout.pay({
        network,
        destination: wallet,
        amountXlm: rewardXlm.toFixed(7),
      });
      await this.prisma.$executeRawUnsafe(
        `update faucet_claims
         set status = 'paid', payout_tx_hash = $2, paid_at = now(), updated_at = now()
         where id = $1::uuid`,
        claimId,
        payoutTxHash,
      );
      console.log(`[faucet] claim ${claimId} paid (${payoutTxHash})`);
      return { claimed: true, status: 'paid', payoutTxHash, rewardXlm };
    } catch (err) {
      const reason =
        err instanceof PayoutError ? err.reason : 'payout-error';
      await this.prisma.$executeRawUnsafe(
        `update faucet_claims
         set status = 'failed', failure_reason = $2, updated_at = now()
         where id = $1::uuid`,
        claimId,
        reason.slice(0, 500),
      );
      console.warn(`[faucet] claim ${claimId} FAILED: ${reason}`);
      return { claimed: false, status: 'failed', reason: 'payout-failed' };
    }
  }

  // --- Ops snapshot (/v1/ops/metrics) ---------------------------------------

  /**
   * Public read-only drain visibility. Exposes counts + treasury SPENDABLE
   * balance — never the treasury address, never anything about the key.
   */
  async getOpsSnapshot() {
    const network = faucetNetwork();
    const enabled = isFaucetEnabled();
    const counts = await this.claimCounts(network);
    const remaining = Math.max(0, faucetMaxClaims() - counts.counted);
    return {
      enabled,
      network,
      rewardXlm: faucetRewardXlm(),
      claims: {
        pending: counts.pending,
        paid: counts.paid,
        failed: counts.failed,
        paid24h: counts.paid24h,
        remainingClaims: remaining,
      },
      // Only queried while the faucet is live — a dark deploy stays dark.
      treasurySpendableXlm: enabled
        ? await this.payout.treasurySpendableXlm(network)
        : null,
    };
  }

  // --- Facts gathering ------------------------------------------------------

  private async campaignFacts(network: FaucetNetwork): Promise<CampaignFacts> {
    const counts = await this.claimCounts(network);
    return {
      enabled: isFaucetEnabled(),
      maxClaims: faucetMaxClaims(),
      countedClaims: counts.counted,
      claimsLastHour: counts.lastHour,
      hourlyCap: faucetHourlyClaimCap(),
    };
  }

  private async claimCounts(network: FaucetNetwork) {
    const rows = (await this.prisma.$queryRawUnsafe(
      `select
         count(*)::int as counted,
         count(*) filter (where created_at > now() - interval '1 hour')::int as last_hour,
         count(*) filter (where status = 'pending')::int as pending,
         count(*) filter (where status = 'paid')::int as paid,
         count(*) filter (where status = 'failed')::int as failed,
         count(*) filter (where status = 'paid' and paid_at > now() - interval '24 hours')::int as paid_24h
       from faucet_claims
       where network = $1`,
      network,
    )) as CountsRow[];
    const row = rows[0];
    return {
      counted: toInt(row?.counted),
      lastHour: toInt(row?.last_hour),
      pending: toInt(row?.pending),
      paid: toInt(row?.paid),
      failed: toInt(row?.failed),
      paid24h: toInt(row?.paid_24h),
    };
  }

  private async walletFacts(wallet: string, network: FaucetNetwork) {
    // Best qualifying witness: faucet kinds only (NEVER blend-withdraw), on
    // the faucet network, preferring one that meets the min-notional rule.
    const witnesses = (await this.prisma.$queryRawUnsafe(
      `select tx_hash, user_id::text as user_id, meets_min_notional
       from action_witnesses
       where lower(wallet_address) = lower($1)
         and network = $2
         and kind in ('sdex-swap', 'blend-deposit')
       order by meets_min_notional desc, verified_at desc
       limit 1`,
      wallet,
      network,
    )) as WitnessRow[];
    const witness = witnesses[0] ?? null;
    const witnessState: WitnessState = !witness
      ? 'none'
      : witness.meets_min_notional
        ? 'ok'
        : 'below-min';

    // One claim per wallet AND per user, ever (global across networks — the
    // unique indexes enforce the same rule at write time).
    const claims = (await this.prisma.$queryRawUnsafe(
      `select status, payout_tx_hash
       from faucet_claims
       where lower(wallet_address) = lower($1)
          or ($2::uuid is not null and user_id = $2::uuid)
       order by created_at asc
       limit 1`,
      wallet,
      witness?.user_id ?? null,
    )) as ClaimRow[];
    const prior = claims[0];
    const priorClaim: PriorClaim = prior
      ? {
          status: prior.status as 'pending' | 'paid' | 'failed',
          payoutTxHash: prior.payout_tx_hash,
        }
      : null;

    return { witness, witnessState, priorClaim };
  }
}
