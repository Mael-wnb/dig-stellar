// apps/api/src/scripts/84-campaign-award.lib.ts
//
// Lot EP (EP1, gate 3): the PURE planning half of the award job. Given the
// candidate witnesses (oldest first), the existing per-day award counts and
// each wallet's check-in days, decide every action award in order, carrying
// the day counts forward so same-day candidates inside one run respect the
// daily caps. No I/O: 84-campaign-award.lib.spec.ts covers it without a DB.

import {
  actionAward,
  streakLengthBefore,
  utcDay,
  type ActionAwardSkipReason,
  type ActionKind,
} from '../modules/campaign/campaign-rules';

export interface AwardCandidate {
  txHash: string;
  address: string;
  userId: string | null;
  kind: ActionKind;
  meetsMinNotional: boolean;
  closedAtMs: number;
}

export interface PlannedAward {
  txHash: string;
  address: string;
  userId: string | null;
  reason: `action:${ActionKind}`;
  basePoints: number;
  multiplier: number;
  points: number;
  countedDay: string;
}

export type SkipCounts = Record<ActionAwardSkipReason, number>;

export interface AwardPlan {
  awards: PlannedAward[];
  skipped: SkipCounts;
}

export const EMPTY_SKIPS = (): SkipCounts => ({
  'outside-window': 0,
  'kind-not-awarded': 0,
  'below-min-notional': 0,
  'daily-cap-reached': 0,
});

/** Key of the per-(wallet, reason, UTC day) award counter. */
export function countKey(address: string, reason: string, day: string): string {
  return `${address.toLowerCase()}|${reason}|${day}`;
}

/** Build the counter map from `countedActionsByDay` rows. */
export function countsFromRows(rows: Array<{ address: string; reason: string; day: string; n: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) map.set(countKey(r.address, r.reason, r.day), (map.get(countKey(r.address, r.reason, r.day)) ?? 0) + r.n);
  return map;
}

/** Build the per-wallet check-in day sets from `checkinDaysByWallet` rows. */
export function checkinSetsFromRows(rows: Array<{ address: string; day: string }>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = r.address.toLowerCase();
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(r.day);
  }
  return map;
}

const NO_CHECKINS: ReadonlySet<string> = new Set();

/**
 * Plan every award in candidate order. `countedBefore` is COPIED and advanced
 * as awards are planned, so a wallet's sixth swap of a day is skipped even
 * when all six arrive in the same run.
 */
export function planActionAwards(
  candidates: ReadonlyArray<AwardCandidate>,
  countedBefore: ReadonlyMap<string, number>,
  checkinDays: ReadonlyMap<string, ReadonlySet<string>>,
  window: { startsAtMs: number | null; endsAtMs: number | null },
): AwardPlan {
  const counts = new Map(countedBefore);
  const awards: PlannedAward[] = [];
  const skipped = EMPTY_SKIPS();

  for (const c of candidates) {
    const reason = `action:${c.kind}` as const;
    const day = utcDay(c.closedAtMs);
    const key = countKey(c.address, reason, day);
    const result = actionAward({
      kind: c.kind,
      meetsMinNotional: c.meetsMinNotional,
      closedAtMs: c.closedAtMs,
      countedSameDayBefore: counts.get(key) ?? 0,
      streakDaysBeforeDay: streakLengthBefore(checkinDays.get(c.address.toLowerCase()) ?? NO_CHECKINS, day),
      window,
    });
    if (!result.award) {
      skipped[result.reason] += 1;
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
    awards.push({
      txHash: c.txHash,
      address: c.address,
      userId: c.userId,
      reason: result.reason,
      basePoints: result.basePoints,
      multiplier: result.multiplier,
      points: result.points,
      countedDay: result.countedDay,
    });
  }

  return { awards, skipped };
}
