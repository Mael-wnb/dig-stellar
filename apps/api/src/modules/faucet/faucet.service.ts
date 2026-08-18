// apps/api/src/modules/faucet/faucet.service.ts
//
// R2 (Lot R — T3-D2) / campaign 2 (Lot R2): claims orchestration. Gathers the
// facts (DB + treasury), runs the ONE pure decision procedure
// (faucet-eligibility.ts) for both the eligibility read and the claim write,
// and drives the serial payout.
//
// Campaign 2: rewards are PER ACTION FAMILY — the wallet facts (witness +
// prior claim) are resolved per family and the pure rules run once per family;
// a claim names the family it is for. Witnesses only qualify when their tx
// executed inside the campaign window (FAUCET_STARTS_AT, fail-closed).
//
// Concurrency model: every claim runs through ONE in-process promise chain —
// payouts are strictly serial by design (the hot wallet's sequence number
// would make parallel submits fail anyway). The API runs as a single pm2
// process (Lot S); if that ever changes, the DB unique indexes on
// faucet_claims (per wallet/user + family + campaign) remain the hard
// backstop against double-pay.
//
// This module imports NOTHING from the user action paths (modules/actions/**)
// — it reads the witness table, never the witness code.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import {
  FAUCET_CAMPAIGN,
  isFaucetEnabled,
  faucetNetwork,
  faucetRewardXlm,
  faucetMaxClaims,
  faucetHourlyClaimCap,
  faucetMinNotionalXlm,
  faucetStartsAt,
  faucetEndsAt,
  type FaucetNetwork,
} from './faucet-config';
import {
  FAUCET_FAMILIES,
  FAMILY_BY_WITNESS_KIND,
  campaignState,
  walletEligibility,
  type ActionFamily,
  type CampaignFacts,
  type PriorClaim,
  type WitnessState,
  type IneligibleReason,
} from './faucet-eligibility';
import { FaucetPayoutService, PayoutError } from './faucet-payout.service';

export interface CampaignPayload {
  /** Which campaign this build serves (faucet_claims.campaign). */
  campaign: number;
  active: boolean;
  remainingClaims: number;
  /** Campaign budget — lets the promo render "54/60 left" honestly (R3b). */
  maxClaims: number;
  rewardXlm: number;
  /** The rewardable families — the promo derives "up to N × reward" from it. */
  families: ActionFamily[];
  network: FaucetNetwork;
  minNotionalXlm: number;
  /**
   * ISO deadline or null (R3b). The server ENFORCES it (past = inactive +
   * 'campaign-ended'); the promo's countdown only renders this value.
   */
  endsAt: string | null;
}

/** Per-family wallet status — feeds the R3 claim panel + promo checklist. */
export interface FamilyStatus {
  eligible: boolean;
  reason?: IneligibleReason;
  /** Present when a claim already exists — feeds R3's paid/failed states. */
  claim?: { status: string; payoutTxHash: string | null };
}

export interface EligibilityPayload {
  campaign: CampaignPayload;
  wallet?: {
    address: string;
    families: Record<ActionFamily, FamilyStatus>;
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
  all_time_pending: unknown;
  all_time_paid: unknown;
  all_time_failed: unknown;
};
type WitnessRow = {
  kind: string;
  tx_hash: string;
  user_id: string;
  meets_min_notional: boolean;
};
type ClaimRow = { action_family: string; status: string; payout_tx_hash: string | null };
type InsertedRow = { id: string };

type FamilyFacts = {
  witness: WitnessRow | null;
  witnessState: WitnessState;
  priorClaim: PriorClaim;
};

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
    const rewardXlm = faucetRewardXlm();
    const campaign: CampaignPayload = {
      campaign: FAUCET_CAMPAIGN,
      ...campaignState(facts),
      maxClaims: facts.maxClaims,
      rewardXlm,
      families: [...FAUCET_FAMILIES],
      network,
      minNotionalXlm: faucetMinNotionalXlm(),
      endsAt: facts.endsAtMs != null ? new Date(facts.endsAtMs).toISOString() : null,
    };
    if (!wallet) return { campaign };

    const byFamily = await this.walletFacts(wallet, network, facts.startsAtMs);

    // Treasury is checked LAST and only when at least one family passes every
    // other check — the pure fn still requires the field, so pass a sentinel
    // that cannot flip the outcome when an earlier check already failed. One
    // Horizon read serves all families (same treasury pays all of them).
    const preTreasury = new Map<ActionFamily, ReturnType<typeof walletEligibility>>();
    for (const family of FAUCET_FAMILIES) {
      const ff = byFamily[family];
      preTreasury.set(
        family,
        walletEligibility({
          ...facts,
          witnessState: ff.witnessState,
          priorClaim: ff.priorClaim,
          treasurySpendableXlm: Number.POSITIVE_INFINITY,
          rewardXlm,
        }),
      );
    }
    const anyPreEligible = [...preTreasury.values()].some((r) => r.eligible);
    const treasurySpendableXlm = anyPreEligible
      ? await this.payout.treasurySpendableXlm(network)
      : null;

    const families = {} as Record<ActionFamily, FamilyStatus>;
    for (const family of FAUCET_FAMILIES) {
      const ff = byFamily[family];
      const pre = preTreasury.get(family)!;
      const result = pre.eligible
        ? walletEligibility({
            ...facts,
            witnessState: ff.witnessState,
            priorClaim: ff.priorClaim,
            treasurySpendableXlm,
            rewardXlm,
          })
        : pre;
      families[family] = {
        eligible: result.eligible,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(ff.priorClaim
          ? { claim: { status: ff.priorClaim.status, payoutTxHash: ff.priorClaim.payoutTxHash } }
          : {}),
      };
    }

    return { campaign, wallet: { address: wallet, families } };
  }

  // --- Claim (POST) ---------------------------------------------------------

  claim(wallet: string, family: ActionFamily): Promise<ClaimPayload> {
    // The WHOLE claim (re-check → insert → payout → record) is serialized, so
    // two concurrent claims can never interleave between re-check and insert.
    return this.serialize(() => this.claimInner(wallet, family));
  }

  private async claimInner(wallet: string, family: ActionFamily): Promise<ClaimPayload> {
    const network = faucetNetwork();
    const rewardXlm = faucetRewardXlm();

    // Full server-side re-check — the GET response is advisory, THIS decides.
    const facts = await this.campaignFacts(network);
    const byFamily = await this.walletFacts(wallet, network, facts.startsAtMs);
    const { witness, witnessState, priorClaim } = byFamily[family];
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

    // An ops mistake (missing key) must not consume the wallet's claim slot
    // for this family — refuse BEFORE inserting anything.
    if (!this.payout.keyAvailable()) {
      return { claimed: false, reason: 'treasury-unavailable' };
    }

    // Insert the pending row. The unique indexes (wallet+family+campaign,
    // user+family+campaign, witness) are the hard guarantee — a 23505
    // violation means a concurrent/prior claim won. ANY OTHER error (e.g. a DB
    // outage) must not masquerade as 'already-claimed': log it and return a
    // distinct honest reason.
    let claimId: string;
    try {
      const rows = (await this.prisma.$queryRawUnsafe(
        `insert into faucet_claims
           (wallet_address, user_id, witness_tx_hash, network, status, reward_xlm, campaign, action_family)
         values ($1, $2::uuid, $3, $4, 'pending', $5, $6, $7)
         returning id::text as id`,
        wallet,
        witness.user_id,
        witness.tx_hash,
        network,
        rewardXlm,
        FAUCET_CAMPAIGN,
        family,
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
      console.log(`[faucet] claim ${claimId} (${family}) paid (${payoutTxHash})`);
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
      console.warn(`[faucet] claim ${claimId} (${family}) FAILED: ${reason}`);
      return { claimed: false, status: 'failed', reason: 'payout-failed' };
    }
  }

  // --- Ops snapshot (/v1/ops/metrics) ---------------------------------------

  /**
   * Public read-only drain visibility. Exposes counts + treasury SPENDABLE
   * balance — never the treasury address, never anything about the key.
   * Counters are scoped to the CURRENT campaign; allTime keeps the campaign-1
   * totals visible (they are evidence).
   */
  async getOpsSnapshot() {
    const network = faucetNetwork();
    const enabled = isFaucetEnabled();
    const counts = await this.claimCounts(network);
    const remaining = Math.max(0, faucetMaxClaims() - counts.counted);
    return {
      enabled,
      network,
      campaign: FAUCET_CAMPAIGN,
      rewardXlm: faucetRewardXlm(),
      claims: {
        pending: counts.pending,
        paid: counts.paid,
        failed: counts.failed,
        paid24h: counts.paid24h,
        remainingClaims: remaining,
      },
      allTime: {
        pending: counts.allTimePending,
        paid: counts.allTimePaid,
        failed: counts.allTimeFailed,
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
      startsAtMs: faucetStartsAt()?.getTime() ?? null,
      endsAtMs: faucetEndsAt()?.getTime() ?? null,
      nowMs: Date.now(),
    };
  }

  private async claimCounts(network: FaucetNetwork) {
    // Budget/velocity scope to the CURRENT campaign; the velocity brake stays
    // network-scoped like before (campaign-1 rows are all > 1h old anyway,
    // but the filter keeps the semantics explicit). allTime spans campaigns.
    const rows = (await this.prisma.$queryRawUnsafe(
      `select
         count(*) filter (where campaign = $2)::int as counted,
         count(*) filter (where campaign = $2 and created_at > now() - interval '1 hour')::int as last_hour,
         count(*) filter (where campaign = $2 and status = 'pending')::int as pending,
         count(*) filter (where campaign = $2 and status = 'paid')::int as paid,
         count(*) filter (where campaign = $2 and status = 'failed')::int as failed,
         count(*) filter (where campaign = $2 and status = 'paid' and paid_at > now() - interval '24 hours')::int as paid_24h,
         count(*) filter (where status = 'pending')::int as all_time_pending,
         count(*) filter (where status = 'paid')::int as all_time_paid,
         count(*) filter (where status = 'failed')::int as all_time_failed
       from faucet_claims
       where network = $1`,
      network,
      FAUCET_CAMPAIGN,
    )) as CountsRow[];
    const row = rows[0];
    return {
      counted: toInt(row?.counted),
      lastHour: toInt(row?.last_hour),
      pending: toInt(row?.pending),
      paid: toInt(row?.paid),
      failed: toInt(row?.failed),
      paid24h: toInt(row?.paid_24h),
      allTimePending: toInt(row?.all_time_pending),
      allTimePaid: toInt(row?.all_time_paid),
      allTimeFailed: toInt(row?.all_time_failed),
    };
  }

  private async walletFacts(
    wallet: string,
    network: FaucetNetwork,
    startsAtMs: number | null,
  ): Promise<Record<ActionFamily, FamilyFacts>> {
    // Best qualifying witness PER FAMILY: faucet kinds only (NEVER
    // blend-withdraw), on the faucet network, executed INSIDE the campaign
    // window (ledger_closed_at — the on-chain execution time, so re-witnessing
    // an old tx can never re-qualify it), preferring one that meets the
    // min-notional rule. No campaign start (fail-closed) = no witness at all.
    const witnesses =
      startsAtMs == null
        ? []
        : ((await this.prisma.$queryRawUnsafe(
            `select distinct on (kind)
               kind, tx_hash, user_id::text as user_id, meets_min_notional
             from action_witnesses
             where lower(wallet_address) = lower($1)
               and network = $2
               and kind in ('sdex-swap', 'blend-deposit')
               and ledger_closed_at >= $3::timestamptz
             order by kind, meets_min_notional desc, verified_at desc`,
            wallet,
            network,
            new Date(startsAtMs).toISOString(),
          )) as WitnessRow[]);

    const witnessByFamily = new Map<ActionFamily, WitnessRow>();
    for (const w of witnesses) {
      const family = FAMILY_BY_WITNESS_KIND[w.kind];
      if (family) witnessByFamily.set(family, w);
    }

    // Prior claims for (wallet OR user) in THIS campaign, oldest first per
    // family. The user id comes from any qualifying witness (they agree by
    // construction — the witness verifier resolves ownership); with no witness
    // at all the wallet-side match still catches a prior claim.
    const anyUserId = witnesses[0]?.user_id ?? null;
    const claims = (await this.prisma.$queryRawUnsafe(
      `select distinct on (action_family)
         action_family, status, payout_tx_hash
       from faucet_claims
       where campaign = $3
         and (lower(wallet_address) = lower($1)
              or ($2::uuid is not null and user_id = $2::uuid))
       order by action_family, created_at asc`,
      wallet,
      anyUserId,
      FAUCET_CAMPAIGN,
    )) as ClaimRow[];

    const claimByFamily = new Map<string, ClaimRow>();
    for (const c of claims) claimByFamily.set(c.action_family, c);

    const out = {} as Record<ActionFamily, FamilyFacts>;
    for (const family of FAUCET_FAMILIES) {
      const witness = witnessByFamily.get(family) ?? null;
      const witnessState: WitnessState = !witness
        ? 'none'
        : witness.meets_min_notional
          ? 'ok'
          : 'below-min';
      const prior = claimByFamily.get(family);
      const priorClaim: PriorClaim = prior
        ? {
            status: prior.status as 'pending' | 'paid' | 'failed',
            payoutTxHash: prior.payout_tx_hash,
          }
        : null;
      out[family] = { witness, witnessState, priorClaim };
    }
    return out;
  }
}
