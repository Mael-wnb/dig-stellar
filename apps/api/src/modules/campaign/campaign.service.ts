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

import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  CAMPAIGN_ID,
  CHALLENGE_TTL_SECONDS,
  LEADERBOARD_CACHE_MS,
  LEADERBOARD_LIMIT,
  campaignEndsAt,
  campaignStartsAt,
  isCampaignEnabled,
  xRepostUrl,
} from './campaign-config';
import {
  ACTION_RULES,
  DISCLAIMER,
  REFERRAL_POINTS,
  SOCIAL_DAILY_CAP,
  SOCIAL_TASKS,
  STREAK_DAILY_POINTS,
  STREAK_MULTIPLIERS,
  campaignStatus,
  checkinEligibility,
  enrollEligibility,
  previousUtcDay,
  referralCodeFromBytes,
  shortenAddress,
  streakLengthBefore,
  streakLengthOn,
  streakMultiplier,
  type CampaignInactiveReason,
  type CampaignWindow,
  type SocialTaskKey,
  type WriteIneligibleReason,
} from './campaign-rules';
import {
  CampaignRepository,
  ENROLLMENT_WALLET_KEY,
  isUniqueViolation,
  violatedUniqueKey,
  type LeaderboardRow,
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
    streakMultipliers: typeof STREAK_MULTIPLIERS;
    socialTasks: Record<SocialTaskKey, SocialTaskEntry>;
    socialDailyCap: number;
    referral: typeof REFERRAL_POINTS;
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
  streak: { current: number; multiplierForToday: number };
  checkedInToday: boolean;
  pendingVerification: number;
  /** EP2: the social task catalogue with this wallet's claimed state (never the handle). */
  tasks: Array<SocialTaskEntry & { key: SocialTaskKey; claimed: boolean; claimId: string | null; claimedAt: string | null }>;
  perks: string[];
  disclaimer: string;
}

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
        streakMultipliers: STREAK_MULTIPLIERS,
        socialTasks: this.socialTaskCatalogue(),
        socialDailyCap: SOCIAL_DAILY_CAP,
        referral: REFERRAL_POINTS,
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
    const [proven, enrollment, balance, days, today, referredBy, pendingVerification, socialClaims] = await Promise.all([
      this.repo.hasBoundProof(params.address, params.userId),
      this.repo.findEnrollment(CAMPAIGN_ID, params.address),
      this.repo.balance(CAMPAIGN_ID, params.address),
      this.repo.checkinDays(CAMPAIGN_ID, params.address),
      this.repo.todayUtc(),
      this.repo.referredByCode(CAMPAIGN_ID, params.address),
      this.repo.pendingVerificationCount(CAMPAIGN_ID, params.address, w),
      this.repo.listSocialClaims(CAMPAIGN_ID, params.address),
    ]);
    const daySet = new Set(days);
    const checkedInToday = daySet.has(today);
    // "current" = the streak ending today, or the one ending yesterday if the
    // user has not checked in yet today (so it is not shown as broken at 00:01Z).
    const current = checkedInToday ? streakLengthOn(daySet, today) : streakLengthOn(daySet, previousUtcDay(today));
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
      streak: { current, multiplierForToday: streakMultiplier(streakLengthBefore(daySet, today)) },
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
      perks: [],
      disclaimer: DISCLAIMER,
    };
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
