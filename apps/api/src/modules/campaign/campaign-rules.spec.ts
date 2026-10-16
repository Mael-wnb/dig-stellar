// Lot EP (EP1): specs for the PURE campaign rules — one test per branch, with
// the founder-decided constants pinned so a silent value change fails here.

import {
  ACTION_RULES,
  DISCLAIMER,
  LEDGER_REASON_RE,
  REFERRAL_CODE_RE,
  REFERRAL_POINTS,
  SOCIAL_DAILY_CAP,
  SOCIAL_TASKS,
  STREAK_DAILY_POINTS,
  actionAward,
  campaignStatus,
  checkinEligibility,
  enrollEligibility,
  previousUtcDay,
  referralCodeFromBytes,
  streakLengthBefore,
  referralCredit,
  shortenAddress,
  socialAward,
  streakLengthOn,
  streakMultiplier,
  utcDay,
  withinWindow,
  type CampaignWindow,
} from './campaign-rules';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0); // 2026-10-15T12:00:00Z
const START = NOW - 10 * DAY;

const liveWindow = (): CampaignWindow => ({
  enabled: true,
  startsAtMs: START,
  endsAtMs: null,
  nowMs: NOW,
});

describe('constants (founder gate-1 values, 2026-10-15)', () => {
  it('pins the action values, caps and min-notional requirement', () => {
    expect(ACTION_RULES['sdex-swap']).toEqual({ basePoints: 50, dailyCap: 5, requiresMinNotional: true });
    expect(ACTION_RULES['blend-deposit']).toEqual({ basePoints: 100, dailyCap: 3, requiresMinNotional: true });
    expect(ACTION_RULES['blend-withdraw']).toEqual({ basePoints: 0, dailyCap: 0, requiresMinNotional: false });
  });

  it('pins streak, social and referral values', () => {
    expect(STREAK_DAILY_POINTS).toBe(5);
    expect(SOCIAL_TASKS).toEqual({ 'x-follow': 20, 'x-repost': 10, 'community-join': 20 });
    expect(SOCIAL_DAILY_CAP).toBe(50);
    expect(REFERRAL_POINTS).toEqual({ referrer: 100, referee: 50 });
  });

  it('the disclaimer says no monetary value and no conversion, and never mentions a token reward or airdrop', () => {
    expect(DISCLAIMER).toMatch(/no monetary value/);
    expect(DISCLAIMER).toMatch(/not convertible to money or tokens/);
    expect(DISCLAIMER).not.toMatch(/airdrop/i);
  });
});

describe('utc day helpers', () => {
  it('utcDay / previousUtcDay work across month and year boundaries', () => {
    expect(utcDay(Date.UTC(2026, 0, 1, 0, 0, 1))).toBe('2026-01-01');
    expect(utcDay(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe('2026-12-31');
    expect(previousUtcDay('2026-01-01')).toBe('2025-12-31');
    expect(previousUtcDay('2026-03-01')).toBe('2026-02-28');
  });

  it('"day" is UTC, never local: 22:30Z/23:30Z on the 15th is still the 15th although Paris is already the 16th', () => {
    const lateEvening = Date.UTC(2026, 9, 15, 22, 30); // 00:30 Europe/Paris (CEST, +02:00) on the 16th
    const almostMidnight = Date.UTC(2026, 9, 15, 23, 30); // 01:30 Europe/Paris on the 16th
    const parisDay = (ms: number) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(ms));
    expect(parisDay(lateEvening)).toBe('2026-10-16');
    expect(parisDay(almostMidnight)).toBe('2026-10-16');
    expect(utcDay(lateEvening)).toBe('2026-10-15');
    expect(utcDay(almostMidnight)).toBe('2026-10-15');
    // The same instant 30 minutes later IS the next UTC day.
    expect(utcDay(Date.UTC(2026, 9, 16, 0, 0))).toBe('2026-10-16');
  });
});

describe('LEDGER_REASON_RE (same regex as points_ledger_reason_check)', () => {
  it('matches every reason a rule can produce', () => {
    const window = { startsAtMs: START, endsAtMs: null };
    const produced: string[] = [];
    for (const kind of ['sdex-swap', 'blend-deposit'] as const) {
      const r = actionAward({ kind, meetsMinNotional: true, closedAtMs: NOW, countedSameDayBefore: 0, streakDaysBeforeDay: 0, window });
      if (r.award) produced.push(r.reason);
    }
    for (const task of Object.keys(SOCIAL_TASKS)) {
      const r = socialAward(task, 0);
      if (r.award) produced.push(r.reason);
    }
    produced.push('streak:daily', 'referral:referrer', 'referral:referee', 'adjust:founder-review-2026-10-16');
    expect(produced).toHaveLength(2 + 3 + 4);
    for (const reason of produced) expect(reason).toMatch(LEDGER_REASON_RE);
  });

  it('rejects anything outside the closed set', () => {
    for (const bad of ['action:blend-borrow', 'streak:weekly', 'social:x-like', 'referral:both', 'adjust:', 'bonus:100', '', 'action:sdex-swap ']) {
      expect(bad).not.toMatch(LEDGER_REASON_RE);
    }
  });
});

describe('streakLengthOn / streakMultiplier', () => {
  it('counts consecutive days ending at the given day, inclusive', () => {
    const days = new Set(['2026-10-13', '2026-10-14', '2026-10-15']);
    expect(streakLengthOn(days, '2026-10-15')).toBe(3);
    expect(streakLengthOn(days, '2026-10-14')).toBe(2);
  });

  it('is 0 when the day itself has no check-in (a gap ends the streak)', () => {
    const days = new Set(['2026-10-13', '2026-10-14']);
    expect(streakLengthOn(days, '2026-10-15')).toBe(0);
    expect(streakLengthOn(new Set(['2026-10-12', '2026-10-14', '2026-10-15']), '2026-10-15')).toBe(2);
  });

  it('streakLengthBefore is the streak ending on D-1: a check-in on D itself never counts', () => {
    const days = new Set(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(streakLengthBefore(days, '2026-10-15')).toBe(3); // D-1 = 14th, streak 12..14
    days.add('2026-10-15'); // a check-in made later on day D
    expect(streakLengthBefore(days, '2026-10-15')).toBe(3); // unchanged
    expect(streakLengthOn(days, '2026-10-15')).toBe(4); // (what it would have been with D counted)
    expect(streakLengthBefore(new Set(['2026-10-15']), '2026-10-15')).toBe(0); // first-ever check-in on D
  });

  it('multiplier is x1.0 under 7 days, x1.2 from 7, x1.35 from 30', () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(6)).toBe(1);
    expect(streakMultiplier(7)).toBe(1.2);
    expect(streakMultiplier(29)).toBe(1.2);
    expect(streakMultiplier(30)).toBe(1.35);
    expect(streakMultiplier(400)).toBe(1.35);
  });
});

describe('campaignStatus / withinWindow', () => {
  it('is active with the flag on, a past start and no deadline', () => {
    expect(campaignStatus(liveWindow())).toEqual({ active: true });
  });

  it('dark deploy: flag off wins over everything', () => {
    expect(campaignStatus({ ...liveWindow(), enabled: false })).toEqual({
      active: false,
      reason: 'campaign-disabled',
    });
  });

  it('fail-closed: unset or future startsAt = not started', () => {
    expect(campaignStatus({ ...liveWindow(), startsAtMs: null }).active).toBe(false);
    expect(campaignStatus({ ...liveWindow(), startsAtMs: NOW + DAY })).toEqual({
      active: false,
      reason: 'campaign-not-started',
    });
  });

  it('a past endsAt ends it; a future one does not', () => {
    expect(campaignStatus({ ...liveWindow(), endsAtMs: NOW - 1 })).toEqual({
      active: false,
      reason: 'campaign-ended',
    });
    expect(campaignStatus({ ...liveWindow(), endsAtMs: NOW + 1 }).active).toBe(true);
  });

  it('withinWindow is [startsAt, endsAt) and false when startsAt is unset', () => {
    expect(withinWindow({ startsAtMs: START, endsAtMs: null }, START)).toBe(true);
    expect(withinWindow({ startsAtMs: START, endsAtMs: null }, START - 1)).toBe(false);
    expect(withinWindow({ startsAtMs: START, endsAtMs: NOW }, NOW)).toBe(false);
    expect(withinWindow({ startsAtMs: START, endsAtMs: NOW }, NOW - 1)).toBe(true);
    expect(withinWindow({ startsAtMs: null, endsAtMs: null }, NOW)).toBe(false);
  });
});

describe('actionAward', () => {
  const base = () => ({
    kind: 'sdex-swap' as const,
    meetsMinNotional: true,
    closedAtMs: NOW - DAY,
    countedSameDayBefore: 0,
    streakDaysBeforeDay: 0,
    window: { startsAtMs: START, endsAtMs: null },
  });

  /** Check-in days for a wallet; D = the action's UTC day. */
  const consecutiveDaysEndingOn = (lastDay: string, count: number): Set<string> => {
    const out = new Set<string>();
    let cursor = lastDay;
    for (let i = 0; i < count; i += 1) {
      out.add(cursor);
      cursor = previousUtcDay(cursor);
    }
    return out;
  };

  it('awards 50 points for a qualifying swap at x1.0', () => {
    expect(actionAward(base())).toEqual({
      award: true,
      reason: 'action:sdex-swap',
      basePoints: 50,
      multiplier: 1,
      points: 50,
      countedDay: utcDay(NOW - DAY),
    });
  });

  it('awards 100 for a Blend deposit and applies the streak multiplier to action points', () => {
    const r = actionAward({ ...base(), kind: 'blend-deposit', streakDaysBeforeDay: 7 });
    expect(r).toMatchObject({ award: true, basePoints: 100, multiplier: 1.2, points: 120 });
    const r30 = actionAward({ ...base(), streakDaysBeforeDay: 30 });
    expect(r30).toMatchObject({ award: true, basePoints: 50, multiplier: 1.35, points: 68 }); // round(67.5)
  });

  it('E: the multiplier of an action on day D is fixed by check-ins up to D-1; a check-in later on D changes nothing', () => {
    const closedAtMs = Date.UTC(2026, 9, 15, 9, 0); // action at 09:00Z on D = 2026-10-15
    const D = utcDay(closedAtMs);
    const checkins = consecutiveDaysEndingOn(previousUtcDay(D), 6); // 9th..14th → 6 days before D
    const before = actionAward({ ...base(), closedAtMs, streakDaysBeforeDay: streakLengthBefore(checkins, D) });
    expect(before).toMatchObject({ award: true, multiplier: 1, points: 50 });

    checkins.add(D); // the user checks in at 18:00Z on D, after the action, before the job runs
    const after = actionAward({ ...base(), closedAtMs, streakDaysBeforeDay: streakLengthBefore(checkins, D) });
    expect(after).toEqual(before);
  });

  it('E: 7-day and 30-day boundaries are computed on D-1', () => {
    const closedAtMs = Date.UTC(2026, 9, 15, 9, 0);
    const D = utcDay(closedAtMs);
    const run = (daysEndingOnDminus1: number) =>
      actionAward({
        ...base(),
        closedAtMs,
        streakDaysBeforeDay: streakLengthBefore(consecutiveDaysEndingOn(previousUtcDay(D), daysEndingOnDminus1), D),
      });
    expect(run(6)).toMatchObject({ multiplier: 1, points: 50 });
    expect(run(7)).toMatchObject({ multiplier: 1.2, points: 60 });
    expect(run(29)).toMatchObject({ multiplier: 1.2, points: 60 });
    expect(run(30)).toMatchObject({ multiplier: 1.35, points: 68 });
    // 7 consecutive days that END on D (not D-1) are only 6 before D: still x1.0.
    const endingOnD = consecutiveDaysEndingOn(D, 7);
    expect(actionAward({ ...base(), closedAtMs, streakDaysBeforeDay: streakLengthBefore(endingOnD, D) })).toMatchObject({
      multiplier: 1,
    });
  });

  it('never awards a withdraw', () => {
    expect(actionAward({ ...base(), kind: 'blend-withdraw' })).toEqual({
      award: false,
      reason: 'kind-not-awarded',
    });
  });

  it('refuses a witness below the min notional', () => {
    expect(actionAward({ ...base(), meetsMinNotional: false })).toEqual({
      award: false,
      reason: 'below-min-notional',
    });
  });

  it('refuses a witness outside the campaign window (before start, at/after end)', () => {
    expect(actionAward({ ...base(), closedAtMs: START - 1 })).toEqual({ award: false, reason: 'outside-window' });
    expect(actionAward({ ...base(), window: { startsAtMs: START, endsAtMs: NOW - DAY } })).toEqual({
      award: false,
      reason: 'outside-window',
    });
  });

  it('enforces the per-kind daily cap: 5 swaps, 3 deposits per wallet per UTC day', () => {
    expect(actionAward({ ...base(), countedSameDayBefore: 4 }).award).toBe(true);
    expect(actionAward({ ...base(), countedSameDayBefore: 5 })).toEqual({ award: false, reason: 'daily-cap-reached' });
    expect(actionAward({ ...base(), kind: 'blend-deposit', countedSameDayBefore: 2 }).award).toBe(true);
    expect(actionAward({ ...base(), kind: 'blend-deposit', countedSameDayBefore: 3 }).award).toBe(false);
  });

  it('window check comes before every other reason', () => {
    expect(
      actionAward({ ...base(), closedAtMs: START - 1, meetsMinNotional: false, countedSameDayBefore: 9 }).reason,
    ).toBe('outside-window');
  });
});

describe('checkinEligibility', () => {
  const ok = () => ({ window: liveWindow(), proven: true, enrolled: true, alreadyCheckedInToday: false });

  it('passes the baseline', () => expect(checkinEligibility(ok())).toEqual({ ok: true }));

  it('campaign status is checked first', () => {
    expect(checkinEligibility({ ...ok(), window: { ...liveWindow(), enabled: false }, proven: false })).toEqual({
      ok: false,
      reason: 'campaign-disabled',
    });
  });

  it('requires an ownership proof, then enrolment, then one check-in per day', () => {
    expect(checkinEligibility({ ...ok(), proven: false })).toEqual({ ok: false, reason: 'ownership-proof-required' });
    expect(checkinEligibility({ ...ok(), enrolled: false })).toEqual({ ok: false, reason: 'not-enrolled' });
    expect(checkinEligibility({ ...ok(), alreadyCheckedInToday: true })).toEqual({
      ok: false,
      reason: 'already-checked-in',
    });
  });
});

describe('enrollEligibility', () => {
  const ok = () => ({ window: liveWindow(), proven: true, alreadyEnrolled: false });

  it('passes the baseline, with or without a valid referral code', () => {
    expect(enrollEligibility(ok())).toEqual({ ok: true });
    expect(enrollEligibility({ ...ok(), referral: { codeKnown: true, referrerIsSelf: false } })).toEqual({ ok: true });
  });

  it('requires an active campaign and a proof; refuses a second enrolment', () => {
    expect(enrollEligibility({ ...ok(), window: { ...liveWindow(), startsAtMs: null } })).toEqual({
      ok: false,
      reason: 'campaign-not-started',
    });
    expect(enrollEligibility({ ...ok(), proven: false })).toEqual({ ok: false, reason: 'ownership-proof-required' });
    expect(enrollEligibility({ ...ok(), alreadyEnrolled: true })).toEqual({ ok: false, reason: 'already-enrolled' });
  });

  it('refuses an unknown referral code and a self-referral', () => {
    expect(enrollEligibility({ ...ok(), referral: { codeKnown: false, referrerIsSelf: false } })).toEqual({
      ok: false,
      reason: 'invalid-referral-code',
    });
    expect(enrollEligibility({ ...ok(), referral: { codeKnown: true, referrerIsSelf: true } })).toEqual({
      ok: false,
      reason: 'self-referral',
    });
  });
});

describe('socialAward', () => {
  it('awards the task value at x1 while under the daily cap', () => {
    expect(socialAward('x-follow', 0)).toEqual({
      award: true,
      reason: 'social:x-follow',
      basePoints: 20,
      multiplier: 1,
      points: 20,
    });
    expect(socialAward('x-repost', 40)).toMatchObject({ award: true, points: 10 }); // exactly at the cap
  });

  it('refuses when the award would exceed the 50/day cap, and refuses unknown tasks', () => {
    expect(socialAward('community-join', 40)).toEqual({ award: false, reason: 'social-daily-cap-reached' });
    expect(socialAward('x-unfollow', 0)).toEqual({ award: false, reason: 'unknown-task' });
    expect(socialAward('__proto__', 0)).toEqual({ award: false, reason: 'unknown-task' });
  });
});

describe('referralCredit', () => {
  const window = { startsAtMs: START, endsAtMs: null };

  it('credits 100/50 once the referee has a verified action at or after the link, inside the window', () => {
    expect(referralCredit({ linkedAtMs: NOW - 2 * DAY, witnessClosedAtMs: NOW - DAY, window })).toEqual({
      credit: true,
      referrerPoints: 100,
      refereePoints: 50,
    });
    expect(referralCredit({ linkedAtMs: NOW - DAY, witnessClosedAtMs: NOW - DAY, window }).credit).toBe(true);
  });

  it('does not credit without a witness, with a witness before the link, or outside the window', () => {
    expect(referralCredit({ linkedAtMs: NOW, witnessClosedAtMs: null, window })).toEqual({
      credit: false,
      reason: 'no-verified-action',
    });
    expect(referralCredit({ linkedAtMs: NOW, witnessClosedAtMs: NOW - 1, window })).toEqual({
      credit: false,
      reason: 'witness-before-link',
    });
    expect(
      referralCredit({ linkedAtMs: NOW - DAY, witnessClosedAtMs: NOW, window: { startsAtMs: START, endsAtMs: NOW } }),
    ).toEqual({ credit: false, reason: 'outside-window' });
  });
});

describe('display helpers', () => {
  it('shortenAddress keeps 4 + 4 characters', () => {
    expect(shortenAddress('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ')).toBe('GAAA…WXYZ');
  });

  it('referralCodeFromBytes yields an 8-char code from the unambiguous alphabet', () => {
    const code = referralCodeFromBytes(new Uint8Array([0, 1, 31, 32, 255, 7, 8, 9, 10]));
    expect(code).toMatch(REFERRAL_CODE_RE);
    expect(code).toHaveLength(8);
    expect(() => referralCodeFromBytes(new Uint8Array(3))).toThrow();
  });
});
