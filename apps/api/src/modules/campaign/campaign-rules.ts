// apps/api/src/modules/campaign/campaign-rules.ts
//
// Lot EP (EP1): PURE campaign rules — points values, daily caps, streak
// multipliers, campaign window, eligibility decisions. No I/O, no Nest, no env:
// every fact arrives as an input so the specs (campaign-rules.spec.ts) can
// exercise every branch in isolation, exactly like faucet-eligibility.ts.
// The service and the award script gather the facts (DB) and run THESE
// functions — there is one decision procedure per rule.
//
// POINTS ONLY. Points have no monetary value and are not convertible to money
// or tokens (DISCLAIMER below travels in every API payload). Nothing here is a
// reward amount, a price or a yield; points are never folded into an APY.
//
// Founder-decided values (2026-10-15, Lot EP gate 1; gate 1-bis 2026-10-16).
// The ledger stores base_points, multiplier and points per row, so changing
// these constants never rewrites history.
//
// "Day" is always UTC, explicitly: utcDay() here, (now() at time zone 'utc')::date
// in SQL. Never the server's or the user's local time zone.

export const DISCLAIMER =
  'Points have no monetary value and are not convertible to money or tokens. ' +
  'They only unlock non-monetary perks such as beta or early access.';

export type ActionKind = 'sdex-swap' | 'blend-deposit' | 'blend-withdraw';

export type SocialTaskKey = 'x-follow' | 'x-repost' | 'community-join';

/** Closed set of ledger reasons. 'adjust:<note>' is the only founder-written kind. */
export type LedgerReason =
  | `action:${ActionKind}`
  | 'streak:daily'
  | `social:${SocialTaskKey}`
  | 'referral:referrer'
  | 'referral:referee'
  | `adjust:${string}`;

/**
 * The SAME regex as points_ledger_reason_check in stellar_v6_campaign.sql.
 * Every reason a rule produces must match it (campaign-rules.spec.ts asserts
 * this), so a new reason is a schema change AND a rules change, never one alone.
 */
export const LEDGER_REASON_RE =
  /^(action:(sdex-swap|blend-deposit|blend-withdraw)|streak:daily|social:(x-follow|x-repost|community-join)|referral:(referrer|referee)|adjust:.+)$/;

export interface ActionRule {
  basePoints: number;
  /** Max awards counted per wallet per UTC day (0 = never awarded). */
  dailyCap: number;
  /** The witness row's meets_min_notional must be true. */
  requiresMinNotional: boolean;
}

export const ACTION_RULES: Readonly<Record<ActionKind, ActionRule>> = {
  'sdex-swap': { basePoints: 50, dailyCap: 5, requiresMinNotional: true },
  'blend-deposit': { basePoints: 100, dailyCap: 3, requiresMinNotional: true },
  // Withdraws are in the witness ledger (T3-D2 KPI) but earn nothing: the
  // reason stays in the closed set for completeness, never for awarding.
  'blend-withdraw': { basePoints: 0, dailyCap: 0, requiresMinNotional: false },
};

export const STREAK_DAILY_POINTS = 5;

/**
 * Applied to ACTION points only, from the streak length ending on the UTC day
 * BEFORE the action's day (streakLengthBefore). See actionAward.
 */
export const STREAK_MULTIPLIERS: ReadonlyArray<{ minDays: number; multiplier: number }> = [
  { minDays: 30, multiplier: 1.35 },
  { minDays: 7, multiplier: 1.2 },
  { minDays: 0, multiplier: 1 },
];

export const SOCIAL_TASKS: Readonly<Record<SocialTaskKey, number>> = {
  'x-follow': 20,
  'x-repost': 10,
  'community-join': 20,
};

/** Per-wallet cap on social points per UTC day. */
export const SOCIAL_DAILY_CAP = 50;

export const REFERRAL_POINTS = { referrer: 100, referee: 50 } as const;

// ---------------------------------------------------------------------------
// UTC day helpers
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' in UTC. */
export function utcDay(at: Date | number): string {
  const d = at instanceof Date ? at : new Date(at);
  return d.toISOString().slice(0, 10);
}

export function previousUtcDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDay(d);
}

/**
 * Consecutive check-in days ending AT `day` (inclusive). 0 when `day` itself has
 * no check-in — a streak is only alive on a day the wallet checked in.
 */
export function streakLengthOn(checkinDays: ReadonlySet<string>, day: string): number {
  let length = 0;
  let cursor = day;
  while (checkinDays.has(cursor)) {
    length += 1;
    cursor = previousUtcDay(cursor);
  }
  return length;
}

/**
 * Consecutive check-in days ending on the day BEFORE `day` (D-1, inclusive).
 * This is the streak an action on UTC day D is multiplied by: it is fixed
 * before day D starts, so the award can never depend on when the award job
 * runs relative to the user's check-in on day D.
 */
export function streakLengthBefore(checkinDays: ReadonlySet<string>, day: string): number {
  return streakLengthOn(checkinDays, previousUtcDay(day));
}

export function streakMultiplier(streakDays: number): number {
  for (const tier of STREAK_MULTIPLIERS) {
    if (streakDays >= tier.minDays) return tier.multiplier;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Campaign window
// ---------------------------------------------------------------------------

export interface CampaignWindow {
  enabled: boolean;
  /** null = unset → fail-closed, not started. */
  startsAtMs: number | null;
  /** null = no deadline. */
  endsAtMs: number | null;
  nowMs: number;
}

export type CampaignInactiveReason =
  | 'campaign-disabled'
  | 'campaign-not-started'
  | 'campaign-ended';

export type CampaignStatus =
  | { active: true }
  | { active: false; reason: CampaignInactiveReason };

export function campaignStatus(w: CampaignWindow): CampaignStatus {
  if (!w.enabled) return { active: false, reason: 'campaign-disabled' };
  if (w.startsAtMs == null || w.nowMs < w.startsAtMs) {
    return { active: false, reason: 'campaign-not-started' };
  }
  if (w.endsAtMs != null && w.nowMs >= w.endsAtMs) {
    return { active: false, reason: 'campaign-ended' };
  }
  return { active: true };
}

/** Is an instant inside [startsAt, endsAt)? Independent of `enabled` and `now`. */
export function withinWindow(w: Pick<CampaignWindow, 'startsAtMs' | 'endsAtMs'>, atMs: number): boolean {
  if (w.startsAtMs == null) return false;
  if (atMs < w.startsAtMs) return false;
  if (w.endsAtMs != null && atMs >= w.endsAtMs) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Action awards (the award job runs this per candidate witness)
// ---------------------------------------------------------------------------

export interface ActionAwardFacts {
  kind: ActionKind;
  meetsMinNotional: boolean;
  /** action_witnesses.ledger_closed_at */
  closedAtMs: number;
  /** Awards of the same kind already counted for this wallet on the same UTC day. */
  countedSameDayBefore: number;
  /**
   * Streak length ending on the UTC day BEFORE the action's day
   * (streakLengthBefore(checkins, utcDay(closedAtMs))). Deterministic: a check-in
   * made later on the action's own day never changes this award.
   */
  streakDaysBeforeDay: number;
  window: Pick<CampaignWindow, 'startsAtMs' | 'endsAtMs'>;
}

export type ActionAwardSkipReason =
  | 'outside-window'
  | 'kind-not-awarded'
  | 'below-min-notional'
  | 'daily-cap-reached';

export type ActionAward =
  | {
      award: true;
      reason: `action:${ActionKind}`;
      basePoints: number;
      multiplier: number;
      points: number;
      countedDay: string;
    }
  | { award: false; reason: ActionAwardSkipReason };

export function actionAward(f: ActionAwardFacts): ActionAward {
  const rule = ACTION_RULES[f.kind];
  if (!withinWindow(f.window, f.closedAtMs)) return { award: false, reason: 'outside-window' };
  if (rule.basePoints <= 0 || rule.dailyCap <= 0) return { award: false, reason: 'kind-not-awarded' };
  if (rule.requiresMinNotional && !f.meetsMinNotional) {
    return { award: false, reason: 'below-min-notional' };
  }
  if (f.countedSameDayBefore >= rule.dailyCap) return { award: false, reason: 'daily-cap-reached' };

  const multiplier = streakMultiplier(f.streakDaysBeforeDay);
  return {
    award: true,
    reason: `action:${f.kind}`,
    basePoints: rule.basePoints,
    multiplier,
    points: Math.round(rule.basePoints * multiplier),
    countedDay: utcDay(f.closedAtMs),
  };
}

// ---------------------------------------------------------------------------
// Streak check-in
// ---------------------------------------------------------------------------

export type WriteIneligibleReason =
  | CampaignInactiveReason
  | 'ownership-proof-required'
  | 'not-enrolled'
  | 'already-enrolled'
  | 'already-checked-in'
  | 'invalid-referral-code'
  | 'self-referral';

export interface CheckinFacts {
  window: CampaignWindow;
  proven: boolean;
  enrolled: boolean;
  alreadyCheckedInToday: boolean;
}

export type WriteDecision = { ok: true } | { ok: false; reason: WriteIneligibleReason };

/** First failing condition, in check order (honest UX). */
export function checkinEligibility(f: CheckinFacts): WriteDecision {
  const status = campaignStatus(f.window);
  if (!status.active) return { ok: false, reason: status.reason };
  if (!f.proven) return { ok: false, reason: 'ownership-proof-required' };
  if (!f.enrolled) return { ok: false, reason: 'not-enrolled' };
  if (f.alreadyCheckedInToday) return { ok: false, reason: 'already-checked-in' };
  return { ok: true };
}

export interface EnrollFacts {
  window: CampaignWindow;
  proven: boolean;
  alreadyEnrolled: boolean;
  /** Present when the caller supplied a referral code. */
  referral?: { codeKnown: boolean; referrerIsSelf: boolean };
}

export function enrollEligibility(f: EnrollFacts): WriteDecision {
  const status = campaignStatus(f.window);
  if (!status.active) return { ok: false, reason: status.reason };
  if (!f.proven) return { ok: false, reason: 'ownership-proof-required' };
  if (f.alreadyEnrolled) return { ok: false, reason: 'already-enrolled' };
  if (f.referral) {
    if (!f.referral.codeKnown) return { ok: false, reason: 'invalid-referral-code' };
    if (f.referral.referrerIsSelf) return { ok: false, reason: 'self-referral' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Social tasks (EP2 writes; the rule ships with the constants)
// ---------------------------------------------------------------------------

export type SocialAward =
  | { award: true; reason: `social:${SocialTaskKey}`; basePoints: number; multiplier: 1; points: number }
  | { award: false; reason: 'unknown-task' | 'social-daily-cap-reached' };

export function socialAward(task: string, awardedTodayPoints: number): SocialAward {
  if (!Object.prototype.hasOwnProperty.call(SOCIAL_TASKS, task)) {
    return { award: false, reason: 'unknown-task' };
  }
  const key = task as SocialTaskKey;
  const basePoints = SOCIAL_TASKS[key];
  if (awardedTodayPoints + basePoints > SOCIAL_DAILY_CAP) {
    return { award: false, reason: 'social-daily-cap-reached' };
  }
  return { award: true, reason: `social:${key}`, basePoints, multiplier: 1, points: basePoints };
}

// ---------------------------------------------------------------------------
// Referral credit (the award job runs this per uncredited referral)
// ---------------------------------------------------------------------------

export interface ReferralCreditFacts {
  linkedAtMs: number;
  /** The referee's earliest qualifying witness close time at or after linkedAt, if any. */
  witnessClosedAtMs: number | null;
  window: Pick<CampaignWindow, 'startsAtMs' | 'endsAtMs'>;
}

export type ReferralCredit =
  | { credit: true; referrerPoints: number; refereePoints: number }
  | { credit: false; reason: 'no-verified-action' | 'witness-before-link' | 'outside-window' };

export function referralCredit(f: ReferralCreditFacts): ReferralCredit {
  if (f.witnessClosedAtMs == null) return { credit: false, reason: 'no-verified-action' };
  if (f.witnessClosedAtMs < f.linkedAtMs) return { credit: false, reason: 'witness-before-link' };
  if (!withinWindow(f.window, f.witnessClosedAtMs)) return { credit: false, reason: 'outside-window' };
  return { credit: true, referrerPoints: REFERRAL_POINTS.referrer, refereePoints: REFERRAL_POINTS.referee };
}

// ---------------------------------------------------------------------------
// Perks (EP3): NON-MONETARY tiers unlocked by points balance
// ---------------------------------------------------------------------------

export type PerkKey = 'early-access' | 'beta-features' | 'priority-rwa';

/**
 * Founder-decided tiers (2026-10-21, EP3). Ascending by threshold; the keys
 * are the SAME closed set as wallet_perks_perk_key_check in
 * stellar_v8_campaign_perks.sql (campaign-rules.spec.ts asserts this), so a
 * new perk is a schema change AND a rules change, never one alone.
 *
 * A perk is a badge / early access / a beta flag — never money, never a token.
 * Once granted it STAYS granted even if the balance later drops (the award job
 * only inserts; revocation is a founder-only manual SQL in docs/runbooks.md).
 */
export const PERK_TIERS: ReadonlyArray<{ key: PerkKey; threshold: number }> = [
  { key: 'early-access', threshold: 100 },
  { key: 'beta-features', threshold: 500 },
  { key: 'priority-rwa', threshold: 1500 },
];

/** Every tier whose threshold the balance reaches (balance >= threshold), ascending. */
export function perksFor(balance: number): PerkKey[] {
  return PERK_TIERS.filter((t) => balance >= t.threshold).map((t) => t.key);
}

export interface NextPerk {
  key: PerkKey;
  threshold: number;
  /** 0 when the balance already reaches the tier but the job has not granted it yet. */
  pointsRemaining: number;
}

/**
 * The lowest tier NOT yet granted, with the points still missing. Grants are
 * the job's (wallet_perks), the balance is live, so a wallet can sit at
 * pointsRemaining 0 for up to one job tick. null when every tier is granted.
 */
export function nextPerkFor(balance: number, granted: ReadonlyArray<PerkKey>): NextPerk | null {
  const tier = PERK_TIERS.find((t) => !granted.includes(t.key));
  if (!tier) return null;
  return { key: tier.key, threshold: tier.threshold, pointsRemaining: Math.max(0, tier.threshold - balance) };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** 'GABC…WXYZ' — the only address form a public payload (leaderboard) carries. */
export function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/** 8-char referral code from random bytes (the service supplies the randomness). */
export function referralCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 8) throw new Error('referralCodeFromBytes needs at least 8 bytes');
  let code = '';
  for (let i = 0; i < 8; i += 1) code += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length];
  return code;
}

export const REFERRAL_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
