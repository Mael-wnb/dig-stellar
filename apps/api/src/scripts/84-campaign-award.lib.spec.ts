// Lot EP (EP1, gate 3): the pure planning half of the award job, without a DB.
import {
  checkinSetsFromRows,
  countKey,
  countsFromRows,
  planActionAwards,
  type AwardCandidate,
} from './84-campaign-award.lib';
import { previousUtcDay } from '../modules/campaign/campaign-rules';

const A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const START = Date.UTC(2026, 9, 1);
const D = Date.UTC(2026, 9, 10, 9, 0); // 2026-10-10 09:00Z
const window = { startsAtMs: START, endsAtMs: null };

const swap = (n: number, overrides: Partial<AwardCandidate> = {}): AwardCandidate => ({
  txHash: `${n}`.padStart(64, '0'),
  address: A,
  userId: '00000000-0000-4000-8000-0000000000aa',
  kind: 'sdex-swap',
  meetsMinNotional: true,
  closedAtMs: D + n * 60_000,
  ...overrides,
});

describe('planActionAwards', () => {
  it('awards in order and carries the daily cap inside one run: 6 same-day swaps → 5 awarded, 1 skipped', () => {
    const plan = planActionAwards([1, 2, 3, 4, 5, 6].map((n) => swap(n)), new Map(), new Map(), window);
    expect(plan.awards).toHaveLength(5);
    expect(plan.awards.map((a) => a.txHash)).toEqual([1, 2, 3, 4, 5].map((n) => `${n}`.padStart(64, '0')));
    expect(plan.skipped).toEqual({ 'outside-window': 0, 'kind-not-awarded': 0, 'below-min-notional': 0, 'daily-cap-reached': 1 });
    expect(plan.awards[0]).toMatchObject({ reason: 'action:sdex-swap', basePoints: 50, multiplier: 1, points: 50, countedDay: '2026-10-10' });
  });

  it('starts the daily count from the existing ledger rows (countedBefore)', () => {
    const before = countsFromRows([{ address: A.toLowerCase(), reason: 'action:sdex-swap', day: '2026-10-10', n: 4 }]);
    const plan = planActionAwards([swap(1), swap(2)], before, new Map(), window);
    expect(plan.awards).toHaveLength(1);
    expect(plan.skipped['daily-cap-reached']).toBe(1);
    expect(countKey(A, 'action:sdex-swap', '2026-10-10')).toBe(`${A.toLowerCase()}|action:sdex-swap|2026-10-10`);
  });

  it('caps are per wallet, per reason and per UTC day', () => {
    const nextDay = Date.UTC(2026, 9, 11, 0, 0, 1);
    const plan = planActionAwards(
      [
        ...[1, 2, 3, 4, 5, 6].map((n) => swap(n)),
        swap(7, { address: B }),
        swap(8, { kind: 'blend-deposit' }),
        swap(9, { closedAtMs: nextDay }),
      ],
      new Map(),
      new Map(),
      window,
    );
    expect(plan.awards).toHaveLength(8); // 5 A swaps + B swap + A deposit + A swap next day
    expect(plan.awards.find((a) => a.txHash === swap(8).txHash)).toMatchObject({ reason: 'action:blend-deposit', points: 100 });
    expect(plan.awards.find((a) => a.txHash === swap(9).txHash)).toMatchObject({ countedDay: '2026-10-11' });
    expect(plan.skipped['daily-cap-reached']).toBe(1);
  });

  it('applies the streak multiplier from check-ins up to D-1, never D', () => {
    const day = '2026-10-10';
    const sevenBefore: Array<{ address: string; day: string }> = [];
    let cursor = previousUtcDay(day);
    for (let i = 0; i < 7; i += 1) {
      sevenBefore.push({ address: A, day: cursor });
      cursor = previousUtcDay(cursor);
    }
    const checkins = checkinSetsFromRows(sevenBefore);
    expect(planActionAwards([swap(1)], new Map(), checkins, window).awards[0]).toMatchObject({ multiplier: 1.2, points: 60 });

    const withToday = checkinSetsFromRows([...sevenBefore, { address: A, day }]);
    expect(planActionAwards([swap(1)], new Map(), withToday, window).awards[0]).toMatchObject({ multiplier: 1.2, points: 60 });

    const sixOnly = checkinSetsFromRows(sevenBefore.slice(0, 6));
    expect(planActionAwards([swap(1)], new Map(), sixOnly, window).awards[0]).toMatchObject({ multiplier: 1, points: 50 });
  });

  it('counts skips without planning them: below min notional, withdraw, outside window', () => {
    const plan = planActionAwards(
      [
        swap(1, { meetsMinNotional: false }),
        swap(2, { kind: 'blend-withdraw' }),
        swap(3, { closedAtMs: START - 1 }),
        swap(4),
      ],
      new Map(),
      new Map(),
      window,
    );
    expect(plan.awards.map((a) => a.txHash)).toEqual([swap(4).txHash]);
    expect(plan.skipped).toEqual({ 'outside-window': 1, 'kind-not-awarded': 1, 'below-min-notional': 1, 'daily-cap-reached': 0 });
  });

  it('never mutates the caller\'s count map', () => {
    const before = new Map<string, number>();
    planActionAwards([swap(1)], before, new Map(), window);
    expect(before.size).toBe(0);
  });
});
