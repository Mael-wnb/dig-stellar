// apps/api/src/modules/campaign/campaign.service.ts
//
// Lot EP (EP1): the campaign service. Gathers facts (repository), runs the
// PURE rules (campaign-rules.ts), writes through the repository. POINTS ONLY:
// nothing here pays, signs or prices anything; every payload carries DISCLAIMER.
//
// Logging: this service never logs an address, a message or a signature. The
// codebase has no hashed-identifier convention for addresses (recon §1.3), so
// the rule is "log nothing identifying" rather than "log a hash".
//
// Ineligibility is a 200 with a structured reason (faucet convention); the
// controllers reserve 4xx for malformed input.
//
// EP3: /me lists the wallet's NON-MONETARY perks (granted by the award job,
// never here) and a flags object the web reads for gating; /metrics serves
// the recon §8 counts with an explicit boundary string, zeros while dark.
// EP4: /me adds today's points, today's action counts vs caps, the pending
// witnesses per kind and the 7-day strip; /me/activity lists the last ledger
// rows (tx hash truncated in SQL). Every number the Earn view shows is
// computed HERE or in the rules — the web renders only.

import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  CAMPAIGN_ID,
  CHALLENGE_TTL_SECONDS,
  LEADERBOARD_CACHE_MS,
  LEADERBOARD_LIMIT,
  METRICS_CACHE_MS,
  campaignEndsAt,
  campaignStartsAt,
  isCampaignEnabled,
  xRepostUrl,
} from './campaign-config';
import {
  ACTION_RULES,
  DISCLAIMER,
  PERK_TIERS,
  REFERRAL_POINTS,
  SOCIAL_DAILY_CAP,
  SOCIAL_TASKS,
  STREAK_DAILY_POINTS,
  STREAK_DAYS_TO_CAP,
  STREAK_RAMP,
  campaignStatus,
  checkinEligibility,
  enrollEligibility,
  nextPerkFor,
  previousUtcDay,
  referralCodeFromBytes,
  shortenAddress,
  streakLadder,
  streakLengthBefore,
  streakLengthOn,
  streakMultiplier,
  type ActionKind,
  type CampaignInactiveReason,
  type CampaignWindow,
  type NextPerk,
  type PerkKey,
  type SocialTaskKey,
  type WriteIneligibleReason,
} from './campaign-rules';
import {
  CampaignRepository,
  ENROLLMENT_WALLET_KEY,
  isUniqueViolation,
  violatedUniqueKey,
  type LeaderboardRow,
  type LedgerActivityRow,
  type MetricsFacts,
  type PendingByKind,
} from './campaign.repository';
import { buildChallengeMessage } from './challenge-message';
import { verifyWalletSignature, type SignatureVariant } from './verify-wallet-signature';

export interface ChallengePayload {
  address: string;
  nonce: string;
  message: string;
  expiresAt: string;
}

export type VerifyPayload =
  | {
      ok: true;
      address: string;
      userId: string | null;
      verifiedAt: string;
      signatureVariant: SignatureVariant;
    }
  | { ok: false; reason: 'challenge-invalid-or-expired' | 'signature-invalid' };

/**
 * EP2: one social task as the UI sees it. `url` is where to do it (the X post
 * for x-repost comes from CAMPAIGN_X_REPOST_URL; null when unset), `available`
 * false = listed as not yet open and refused by the claim rule.
 */
export interface SocialTaskEntry {
  points: number;
  url: string | null;
  available: boolean;
}

export interface CampaignPayload {
  campaign: number;
  active: boolean;
  reason?: CampaignInactiveReason;
  startsAt: string | null;
  endsAt: string | null;
  rules: {
    actions: typeof ACTION_RULES;
    streakDailyPoints: number;
    /**
     * EP4: the daily ramp (multiplier = min(1 + stepPerDay × days, cap)) plus
     * the ladder the strip renders verbatim and the day count at which the
     * cap is reached. Replaces EP1's streakMultipliers tiers.
     */
    streak: {
      stepPerDay: number;
      cap: number;
      dailyPoints: number;
      daysToCap: number;
      ladder: Array<{ days: number; multiplier: number }>;
    };
    socialTasks: Record<SocialTaskKey, SocialTaskEntry>;
    socialDailyCap: number;
    referral: typeof REFERRAL_POINTS;
    /** EP3: the non-monetary tiers (key + points threshold), ascending. */
    perks: typeof PERK_TIERS;
  };
  disclaimer: string;
}

export type EnrollPayload =
  | { enrolled: true; address: string; referralCode: string; referredBy: string | null; disclaimer: string }
  | { enrolled: false; reason: WriteIneligibleReason; disclaimer: string };

export type CheckinPayload =
  | { checkedIn: true; day: string; points: number; disclaimer: string }
  | { checkedIn: false; reason: WriteIneligibleReason; disclaimer: string };

export interface MePayload {
  campaign: number;
  active: boolean;
  reason?: CampaignInactiveReason;
  address: string;
  proven: boolean;
  enrolled: boolean;
  referralCode: string | null;
  referredBy: string | null;
  balance: number;
  /** EP4: sum(points) with counted_day = today (UTC), adjust rows included. */
  pointsToday: number;
  /** EP4: action awards counted today vs the daily cap, per awardable kind. */
  actionsToday: Record<AwardableActionKind, { counted: number; cap: number }>;
  /** EP4: in-window witnesses without a ledger row yet, per awardable kind (sum = pendingVerification). */
  pendingByKind: PendingByKind;
  streak: {
    current: number;
    /** From the streak ending on D-1 (determinism rule): a check-in today changes tomorrow, never today. */
    multiplierForToday: number;
    /** EP4: check-in days still needed (today included when not yet checked in) before the streak reaches the cap length. */
    daysToCap: number;
    /**
     * EP4: the last 7 UTC days ending today, oldest first. `multiplier` is the
     * one that applied ON that day under the D-1 rule (streak ending the day
     * before), so today's entry equals multiplierForToday. Computed here, never
     * in the web.
     */
    last7: Array<{ day: string; checkedIn: boolean; multiplier: number }>;
  };
  checkedInToday: boolean;
  pendingVerification: number;
  /** EP2: the social task catalogue with this wallet's claimed state (never the handle). */
  tasks: Array<SocialTaskEntry & { key: SocialTaskKey; claimed: boolean; claimId: string | null; claimedAt: string | null }>;
  /** EP3: perks granted by the award job (wallet_perks), oldest first. Never revoked here. */
  perks: Array<{ key: PerkKey; grantedAt: string }>;
  /** EP3: the lowest tier not granted yet and the points still missing; null when all are granted. */
  nextPerk: NextPerk | null;
  /** EP3: flags the web may gate on; derived from perks only. */
  flags: { beta: boolean };
  disclaimer: string;
}

/**
 * EP3: GET /v1/campaign/metrics — the recon §8 counts. `dark` (campaign
 * disabled or no start date) → every count is 0 and the web hides the section.
 * Otherwise the window counters cover [startsAt, endsAt) whatever `active`
 * says, so a not-started campaign reads real zeros and an ended one keeps its
 * final numbers.
 */
export interface MetricsPayload extends MetricsFacts {
  campaign: number;
  active: boolean;
  reason?: CampaignInactiveReason;
  dark: boolean;
  window: { startsAt: string | null; endsAt: string | null };
  asOf: string;
  boundary: string;
  disclaimer: string;
}

export type AwardableActionKind = Extract<ActionKind, 'sdex-swap' | 'blend-deposit'>;

/** EP4: one GET /v1/campaign/me/activity row. txHashShort = first 8 chars, action rows only. */
export interface ActivityRow {
  reason: string;
  points: number;
  multiplier: number;
  countedDay: string | null;
  createdAt: string;
  txHashShort: string | null;
}

export interface ActivityPayload {
  campaign: number;
  address: string;
  rows: ActivityRow[];
  disclaimer: string;
}

/** EP4: rows served by /me/activity. */
export const ACTIVITY_LIMIT = 20;

export const METRICS_BOUNDARY =
  'Counts of wallets, not people: a person may hold several wallets. ' +
  'Registered = first registration of a wallet (user_wallets.created_at; re-connects are invisible). ' +
  'Proven = wallets that signed an ownership proof in the window. ' +
  'Verified actions = Horizon-verified on-chain EXECUTIONS (action_witnesses.ledger_closed_at), not server-side builds; ' +
  'only swaps and Blend deposits earn points, withdraws are listed but never awarded. ' +
  'Social claims are self-declared (no X / Discord API check). ' +
  'Every window counter starts at CAMPAIGN_STARTS_AT; no page views, no funnel, no historical backfill.';

const ZERO_FACTS = (): MetricsFacts => ({
  walletsRegisteredInWindow: 0,
  walletsProvenInWindow: 0,
  walletsEnrolled: 0,
  walletsWithVerifiedActionInWindow: 0,
  verifiedActionsByKind: { 'sdex-swap': 0, 'blend-deposit': 0, 'blend-withdraw': 0 },
  referralsCredited: 0,
  socialClaimsActive: 0,
  pointsIssued: 0,
  perksGranted: { 'early-access': 0, 'beta-features': 0, 'priority-rwa': 0 },
});

export interface LeaderboardPayload {
  campaign: number;
  asOf: string;
  rows: Array<{ rank: number; address: string; points: number }>;
  me: { rank: number; points: number } | null;
  disclaimer: string;
}

@Injectable()
export class CampaignService {
  private leaderboardCache: { at: number; rows: LeaderboardRow[] } | null = null;
  private metricsCache: { at: number; facts: MetricsFacts } | null = null;

  constructor(private readonly repo: CampaignRepository) {}

  /** Current window facts from the lazily-read env (faucet-config pattern). */
  window(now: number = Date.now()): CampaignWindow {
    return {
      enabled: isCampaignEnabled(),
      startsAtMs: campaignStartsAt()?.getTime() ?? null,
      endsAtMs: campaignEndsAt()?.getTime() ?? null,
      nowMs: now,
    };
  }

  // --- Ownership proof (always on; a primitive, not a campaign feature) -----

  async issueChallenge(address: string): Promise<ChallengePayload> {
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_SECONDS * 1000);
    const message = buildChallengeMessage({ address, nonce, issuedAtIso: issuedAt.toISOString() });
    await this.repo.createChallenge({ nonce, address, message, issuedAt, expiresAt });
    // Bounded housekeeping on the write path — no separate job.
    await this.repo.deleteStaleChallenges();
    return { address, nonce, message, expiresAt: expiresAt.toISOString() };
  }

  async verifyChallenge(params: {
    address: string;
    nonce: string;
    signedMessage: string;
    provider: string | null;
    userId: string | null;
  }): Promise<VerifyPayload> {
    // F. One atomic consume; the nonce is burnt from here on, pass or fail.
    const message = await this.repo.consumeChallenge(params.nonce, params.address);
    if (message == null) return { ok: false, reason: 'challenge-invalid-or-expired' };

    const result = verifyWalletSignature(params.address, message, params.signedMessage);
    if (!result.ok) return { ok: false, reason: 'signature-invalid' };

    const proof = params.userId
      ? await this.repo.upsertBoundProof({
          address: params.address,
          userId: params.userId,
          provider: params.provider,
          nonce: params.nonce,
          variant: result.variant,
        })
      : await this.repo.insertUnboundProof({
          address: params.address,
          provider: params.provider,
          nonce: params.nonce,
          variant: result.variant,
        });

    return {
      ok: true,
      address: params.address,
      userId: proof.user_id,
      verifiedAt: proof.verified_at.toISOString(),
      signatureVariant: result.variant,
    };
  }

  // --- Public campaign state ------------------------------------------------

  /** EP2: the social task catalogue (points from the rules, x-repost URL from the env). */
  socialTaskCatalogue(): Record<SocialTaskKey, SocialTaskEntry> {
    const repost = xRepostUrl();
    return {
      'x-follow': { points: SOCIAL_TASKS['x-follow'], url: null, available: true },
      'x-repost': { points: SOCIAL_TASKS['x-repost'], url: repost, available: repost != null },
      'community-join': { points: SOCIAL_TASKS['community-join'], url: null, available: true },
    };
  }

  getCampaign(): CampaignPayload {
    const w = this.window();
    const status = campaignStatus(w);
    return {
      campaign: CAMPAIGN_ID,
      active: status.active,
      ...(status.active ? {} : { reason: status.reason }),
      startsAt: w.startsAtMs != null ? new Date(w.startsAtMs).toISOString() : null,
      endsAt: w.endsAtMs != null ? new Date(w.endsAtMs).toISOString() : null,
      rules: {
        actions: ACTION_RULES,
        streakDailyPoints: STREAK_DAILY_POINTS,
        streak: {
          stepPerDay: STREAK_RAMP.stepPerDay,
          cap: STREAK_RAMP.cap,
          dailyPoints: STREAK_DAILY_POINTS,
          daysToCap: STREAK_DAYS_TO_CAP,
          ladder: streakLadder(),
        },
        socialTasks: this.socialTaskCatalogue(),
        socialDailyCap: SOCIAL_DAILY_CAP,
        referral: REFERRAL_POINTS,
        perks: PERK_TIERS,
      },
      disclaimer: DISCLAIMER,
    };
  }

  // --- Writes (campaign must be active; proof required) ---------------------

  async enroll(params: { address: string; userId: string; referralCode: string | null }): Promise<EnrollPayload> {
    const w = this.window();
    const status = campaignStatus(w);
    if (!status.active) return { enrolled: false, reason: status.reason, disclaimer: DISCLAIMER };

    try {
      return await this.repo.transaction(async (r) => {
        const proven = await r.hasBoundProof(params.address, params.userId);
        const existing = await r.findEnrollment(CAMPAIGN_ID, params.address);
        const referrer = params.referralCode ? await r.findEnrollmentByCode(CAMPAIGN_ID, params.referralCode) : null;

        const decision = enrollEligibility({
          window: w,
          proven,
          alreadyEnrolled: existing != null,
          ...(params.referralCode
            ? {
                referral: {
                  codeKnown: referrer != null,
                  referrerIsSelf: referrer != null && referrer.address.toLowerCase() === params.address.toLowerCase(),
                },
              }
            : {}),
        });
        if (!decision.ok) return { enrolled: false, reason: decision.reason, disclaimer: DISCLAIMER } as const;

        const enrollment = await r.insertEnrollmentWithCodeRetry(
          {
            campaign: CAMPAIGN_ID,
            address: params.address,
            userId: params.userId,
            referredByCode: referrer?.referral_code ?? null,
          },
          () => referralCodeFromBytes(randomBytes(8)),
        );
        if (referrer) {
          await r.insertReferral({
            campaign: CAMPAIGN_ID,
            refereeAddress: params.address,
            referrerAddress: referrer.address,
            code: referrer.referral_code,
          });
        }
        return {
          enrolled: true,
          address: params.address,
          referralCode: enrollment.referral_code,
          referredBy: referrer?.referral_code ?? null,
          disclaimer: DISCLAIMER,
        } as const;
      });
    } catch (err) {
      // A concurrent enrolment of the same wallet lost the race on the
      // (campaign, wallet) unique index: report it as what it is.
      if (isUniqueViolation(err) && violatedUniqueKey(err) === ENROLLMENT_WALLET_KEY) {
        return { enrolled: false, reason: 'already-enrolled', disclaimer: DISCLAIMER };
      }
      throw err;
    }
  }

  async checkin(params: { address: string; userId: string }): Promise<CheckinPayload> {
    const w = this.window();
    const proven = await this.repo.hasBoundProof(params.address, params.userId);
    const pre = checkinEligibility({ window: w, proven, enrolled: true, alreadyCheckedInToday: false });
    if (!pre.ok) return { checkedIn: false, reason: pre.reason, disclaimer: DISCLAIMER };

    // H. enrolled + once-per-UTC-day are decided under the enrollment row lock.
    const result = await this.repo.checkinToday(CAMPAIGN_ID, params.address);
    if (!result.ok) return { checkedIn: false, reason: result.reason, disclaimer: DISCLAIMER };
    return { checkedIn: true, day: result.day, points: result.points, disclaimer: DISCLAIMER };
  }

  // --- Reads ---------------------------------------------------------------

  async me(params: { address: string; userId: string }): Promise<MePayload> {
    const w = this.window();
    const status = campaignStatus(w);
    // Today (UTC, from the DB clock) first: the day-scoped reads depend on it.
    const today = await this.repo.todayUtc();
    const [proven, enrollment, balance, days, referredBy, pendingByKind, socialClaims, perkRows, pointsToday, countedToday] =
      await Promise.all([
        this.repo.hasBoundProof(params.address, params.userId),
        this.repo.findEnrollment(CAMPAIGN_ID, params.address),
        this.repo.balance(CAMPAIGN_ID, params.address),
        this.repo.checkinDays(CAMPAIGN_ID, params.address),
        this.repo.referredByCode(CAMPAIGN_ID, params.address),
        this.repo.pendingVerificationByKind(CAMPAIGN_ID, params.address, w),
        this.repo.listSocialClaims(CAMPAIGN_ID, params.address),
        this.repo.listPerks(CAMPAIGN_ID, params.address),
        this.repo.pointsOn(CAMPAIGN_ID, params.address, today),
        this.repo.actionsCountedOn(CAMPAIGN_ID, params.address, today),
      ]);
    const perks = perkRows.map((p) => ({ key: p.perk_key, grantedAt: p.granted_at.toISOString() }));
    const grantedKeys = perks.map((p) => p.key);
    const daySet = new Set(days);
    const checkedInToday = daySet.has(today);
    // "current" = the streak ending today, or the one ending yesterday if the
    // user has not checked in yet today (so it is not shown as broken at 00:01Z).
    const current = checkedInToday ? streakLengthOn(daySet, today) : streakLengthOn(daySet, previousUtcDay(today));
    // EP4: the last 7 UTC days ending today, oldest first (strip boxes), each
    // with the multiplier that applied on that day (D-1 rule).
    const last7: Array<{ day: string; checkedIn: boolean; multiplier: number }> = [];
    let cursor = today;
    for (let i = 0; i < 7; i += 1) {
      last7.unshift({
        day: cursor,
        checkedIn: daySet.has(cursor),
        multiplier: streakMultiplier(streakLengthBefore(daySet, cursor)),
      });
      cursor = previousUtcDay(cursor);
    }
    const pendingVerification = pendingByKind['sdex-swap'] + pendingByKind['blend-deposit'];
    return {
      campaign: CAMPAIGN_ID,
      active: status.active,
      ...(status.active ? {} : { reason: status.reason }),
      address: params.address,
      proven,
      enrolled: enrollment != null,
      referralCode: enrollment?.referral_code ?? null,
      referredBy,
      balance,
      pointsToday,
      actionsToday: {
        'sdex-swap': { counted: countedToday['sdex-swap'], cap: ACTION_RULES['sdex-swap'].dailyCap },
        'blend-deposit': { counted: countedToday['blend-deposit'], cap: ACTION_RULES['blend-deposit'].dailyCap },
      },
      pendingByKind,
      streak: {
        current,
        multiplierForToday: streakMultiplier(streakLengthBefore(daySet, today)),
        daysToCap: Math.max(0, STREAK_DAYS_TO_CAP - current),
        last7,
      },
      checkedInToday,
      pendingVerification,
      tasks: (Object.entries(this.socialTaskCatalogue()) as Array<[SocialTaskKey, SocialTaskEntry]>).map(([key, entry]) => {
        const claim = socialClaims.find((c) => c.task_key === key) ?? null;
        return {
          key,
          ...entry,
          claimed: claim != null,
          claimId: claim?.id ?? null,
          claimedAt: claim?.claimed_at.toISOString() ?? null,
        };
      }),
      perks,
      nextPerk: nextPerkFor(balance, grantedKeys),
      flags: { beta: grantedKeys.includes('beta-features') },
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * EP4: GET /v1/campaign/me/activity — the wallet's last ACTIVITY_LIMIT ledger
   * rows, newest first. Same access rule as /me (address + userId, no proof
   * for reads); no-store. The tx hash is truncated by the repository.
   */
  async activity(params: { address: string; userId: string }): Promise<ActivityPayload> {
    const rows = await this.repo.recentLedger(CAMPAIGN_ID, params.address, ACTIVITY_LIMIT);
    return {
      campaign: CAMPAIGN_ID,
      address: params.address,
      rows: rows.map((r: LedgerActivityRow) => ({
        reason: r.reason,
        points: r.points,
        multiplier: r.multiplier,
        countedDay: r.counted_day,
        createdAt: r.created_at.toISOString(),
        txHashShort: r.tx_hash_short,
      })),
      disclaimer: DISCLAIMER,
    };
  }

  /** EP3: public counts with a boundary string; zeros while dark; cached 60 s in-process. */
  async metrics(now: number = Date.now()): Promise<MetricsPayload> {
    const w = this.window(now);
    const status = campaignStatus(w);
    const dark = !w.enabled || w.startsAtMs == null;
    const base = {
      campaign: CAMPAIGN_ID,
      active: status.active,
      ...(status.active ? {} : { reason: status.reason }),
      dark,
      window: {
        startsAt: w.startsAtMs != null ? new Date(w.startsAtMs).toISOString() : null,
        endsAt: w.endsAtMs != null ? new Date(w.endsAtMs).toISOString() : null,
      },
      boundary: METRICS_BOUNDARY,
      disclaimer: DISCLAIMER,
    };
    if (dark) return { ...base, asOf: new Date(now).toISOString(), ...ZERO_FACTS() };

    if (!this.metricsCache || now - this.metricsCache.at > METRICS_CACHE_MS) {
      this.metricsCache = {
        at: now,
        facts: await this.repo.metricsFacts(CAMPAIGN_ID, { startsAtMs: w.startsAtMs!, endsAtMs: w.endsAtMs }),
      };
    }
    return { ...base, asOf: new Date(this.metricsCache.at).toISOString(), ...this.metricsCache.facts };
  }

  async leaderboard(callerAddress: string | null, now: number = Date.now()): Promise<LeaderboardPayload> {
    if (!this.leaderboardCache || now - this.leaderboardCache.at > LEADERBOARD_CACHE_MS) {
      this.leaderboardCache = { at: now, rows: await this.repo.leaderboard(CAMPAIGN_ID, LEADERBOARD_LIMIT) };
    }
    const rows = this.leaderboardCache.rows.map((r, i) => ({
      rank: i + 1,
      address: shortenAddress(r.address),
      points: r.points,
    }));
    const me = callerAddress ? await this.repo.rankOf(CAMPAIGN_ID, callerAddress) : null;
    return {
      campaign: CAMPAIGN_ID,
      asOf: new Date(this.leaderboardCache.at).toISOString(),
      rows,
      me,
      disclaimer: DISCLAIMER,
    };
  }
}
