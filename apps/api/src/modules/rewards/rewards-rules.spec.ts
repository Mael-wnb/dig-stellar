// Lot EP (EP5): the pure rewards rules. Money path: every expectation below is
// an exact stroop figure, never a float comparison.
import {
  allocateDay,
  claimEligibility,
  dayIsAllocatable,
  nextUtcMidnightIso,
  stroopsToNumber,
  stroopsToXlm,
  xlmToStroops,
  type ClaimFacts,
} from './rewards-rules';

const A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const C = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const none = new Set<string>();

describe('stroop arithmetic', () => {
  it('xlmToStroops is exact for env numbers and 7-decimal SQL strings', () => {
    expect(xlmToStroops(100)).toBe(1_000_000_000n);
    expect(xlmToStroops(5)).toBe(50_000_000n);
    expect(xlmToStroops(2.5)).toBe(25_000_000n);
    expect(xlmToStroops(0.1)).toBe(1_000_000n); // never 0.1 × 1e7 = 1000000.0000000001
    expect(xlmToStroops('98.1234567')).toBe(981_234_567n);
    expect(xlmToStroops('0.0000001')).toBe(1n);
    expect(xlmToStroops('7')).toBe(70_000_000n);
  });

  it('rejects what cannot be represented exactly', () => {
    expect(() => xlmToStroops('1.00000001')).toThrow(/invalid XLM amount/);
    expect(() => xlmToStroops('-1')).toThrow(/invalid XLM amount/);
    expect(() => xlmToStroops('abc')).toThrow(/invalid XLM amount/);
    expect(() => xlmToStroops(-1)).toThrow(/invalid XLM amount/);
    expect(() => xlmToStroops(Number.NaN)).toThrow(/invalid XLM amount/);
  });

  it('stroopsToXlm always renders 7 decimals (what numeric(12,7) and the SDK take)', () => {
    expect(stroopsToXlm(981_234_567n)).toBe('98.1234567');
    expect(stroopsToXlm(1n)).toBe('0.0000001');
    expect(stroopsToXlm(0n)).toBe('0.0000000');
    expect(stroopsToXlm(50_000_000n)).toBe('5.0000000');
    expect(stroopsToNumber(12_345_678n)).toBe(1.2345678);
    expect(() => stroopsToXlm(-1n)).toThrow();
  });
});

describe('allocateDay', () => {
  it('shares the pool by points: 100 XLM, points 300 / 100 → 75 / 25 (cap 100 so uncapped)', () => {
    const r = allocateDay({ poolXlm: 100, capXlm: 100, excluded: none, points: [{ address: B, points: 100 }, { address: A, points: 300 }] });
    expect(r.totalPoints).toBe(400);
    expect(r.allocations.map((a) => [a.address, a.pointsDay, a.shareXlm])).toEqual([
      [A, 300, '75.0000000'],
      [B, 100, '25.0000000'],
    ]);
    expect(r.distributedStroops).toBe(1_000_000_000n);
    expect(r.remainderStroops).toBe(0n);
    expect(r.poolXlm).toBe('100.0000000');
    expect(r.capXlm).toBe('100.0000000');
  });

  it('caps every wallet at the daily cap; the uncapped remainder stays in the treasury (not redistributed)', () => {
    const r = allocateDay({ poolXlm: 100, capXlm: 5, excluded: none, points: [{ address: A, points: 300 }, { address: B, points: 100 }] });
    expect(r.allocations.map((a) => a.shareXlm)).toEqual(['5.0000000', '5.0000000']);
    expect(r.distributedStroops).toBe(100_000_000n);
    expect(r.remainderStroops).toBe(900_000_000n); // 90 XLM back to the treasury
  });

  it('excluded addresses are neither allocated nor counted in the Σ (case-insensitive)', () => {
    const r = allocateDay({
      poolXlm: 100,
      capXlm: 100,
      excluded: new Set([C.toLowerCase()]),
      points: [{ address: A, points: 100 }, { address: B, points: 100 }, { address: C, points: 800 }],
    });
    expect(r.excludedWallets).toBe(1);
    expect(r.totalPoints).toBe(200); // C's 800 do not dilute A and B
    expect(r.allocations.map((a) => [a.address, a.shareXlm])).toEqual([[A, '50.0000000'], [B, '50.0000000']]);
  });

  it('a day with Σ points = 0 (no rows, non-positive rows, or only excluded wallets) allocates nothing', () => {
    for (const points of [
      [],
      [{ address: A, points: 0 }, { address: B, points: -5 }],
      [{ address: C, points: 100 }],
    ]) {
      const r = allocateDay({ poolXlm: 100, capXlm: 5, excluded: new Set([C.toLowerCase()]), points });
      expect(r.allocations).toEqual([]);
      expect(r.totalPoints).toBe(0);
      expect(r.distributedStroops).toBe(0n);
      expect(r.remainderStroops).toBe(1_000_000_000n);
    }
  });

  it('floors to the stroop so Σ shares never exceeds the pool; the rounding dust is the remainder', () => {
    // 100 XLM over 3 equal wallets: 33.3333333 each, 1 stroop left over
    const r = allocateDay({ poolXlm: 100, capXlm: 100, excluded: none, points: [{ address: A, points: 1 }, { address: B, points: 1 }, { address: C, points: 1 }] });
    expect(r.allocations.map((a) => a.shareXlm)).toEqual(['33.3333333', '33.3333333', '33.3333333']);
    expect(r.distributedStroops).toBe(999_999_999n);
    expect(r.remainderStroops).toBe(1n);
  });

  it('keeps 7 decimals exactly on an odd pool and odd points (no float drift)', () => {
    const r = allocateDay({ poolXlm: 12.3456789, capXlm: 100, excluded: none, points: [{ address: A, points: 7 }, { address: B, points: 11 }] });
    // pool = 123456789 stroops; A = floor(123456789 × 7 / 18) = 48010973; B = floor(123456789 × 11 / 18) = 75445815
    expect(r.allocations.map((a) => a.shareStroops)).toEqual([48_010_973n, 75_445_815n]);
    expect(r.allocations.map((a) => a.shareXlm)).toEqual(['4.8010973', '7.5445815']);
    expect(r.remainderStroops).toBe(1n);
    expect(r.poolXlm).toBe('12.3456789');
  });

  it('drops a wallet whose share floors to 0 stroops (counted, not inserted)', () => {
    // pool = 10 stroops, points 1 / 10 of 11: A floors to 0, B gets 9, 1 stroop remains
    const r = allocateDay({ poolXlm: '0.0000010' as unknown as number, capXlm: 5, excluded: none, points: [{ address: A, points: 1 }, { address: B, points: 10 }] });
    expect(r.zeroShares).toBe(1);
    expect(r.allocations.map((a) => [a.address, a.shareStroops])).toEqual([[B, 9n]]);
    expect(r.distributedStroops).toBe(9n);
    expect(r.remainderStroops).toBe(1n);
  });

  it('is deterministic: allocations sorted by address whatever the input order', () => {
    const r1 = allocateDay({ poolXlm: 10, capXlm: 10, excluded: none, points: [{ address: C, points: 1 }, { address: A, points: 1 }, { address: B, points: 1 }] });
    const r2 = allocateDay({ poolXlm: 10, capXlm: 10, excluded: none, points: [{ address: B, points: 1 }, { address: C, points: 1 }, { address: A, points: 1 }] });
    expect(r1.allocations).toEqual(r2.allocations);
    expect(r1.allocations.map((a) => a.address)).toEqual([A, B, C]);
  });
});

describe('dayIsAllocatable / nextUtcMidnightIso', () => {
  const GRACE = 30 * 60 * 1000;
  it('a day closes at the next UTC midnight plus the grace; today is never allocatable', () => {
    expect(dayIsAllocatable('2026-10-20', Date.parse('2026-10-21T00:29:59Z'), GRACE)).toBe(false);
    expect(dayIsAllocatable('2026-10-20', Date.parse('2026-10-21T00:30:00Z'), GRACE)).toBe(true);
    expect(dayIsAllocatable('2026-10-21', Date.parse('2026-10-21T23:59:59Z'), GRACE)).toBe(false);
    expect(dayIsAllocatable('2026-10-19', Date.parse('2026-10-21T00:00:00Z'), GRACE)).toBe(true);
    // month boundary
    expect(dayIsAllocatable('2026-10-31', Date.parse('2026-11-01T00:30:00Z'), GRACE)).toBe(true);
  });
  it('nextCloseAt is the coming UTC midnight', () => {
    expect(nextUtcMidnightIso(Date.parse('2026-10-21T15:04:05Z'))).toBe('2026-10-22T00:00:00.000Z');
    expect(nextUtcMidnightIso(Date.parse('2026-10-31T23:59:59Z'))).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe('claimEligibility', () => {
  const ok = (): ClaimFacts => ({
    enabled: true,
    proven: true,
    enrolled: true,
    excluded: false,
    payingInProgress: false,
    lastClaimAtMs: null,
    nowMs: Date.parse('2026-10-21T12:00:00Z'),
    rateLimitMs: 3_600_000,
    claimableStroops: xlmToStroops('3.5000000'),
    minClaimStroops: xlmToStroops(1),
    treasuryBalanceStroops: xlmToStroops(300),
    reserveStroops: xlmToStroops(2),
  });

  it('passes the happy path', () => {
    expect(claimEligibility(ok())).toEqual({ ok: true });
  });

  it('refuses in the documented order, one reason per failing fact', () => {
    const cases: Array<[Partial<ClaimFacts>, string]> = [
      [{ enabled: false }, 'rewards-disabled'],
      [{ proven: false }, 'ownership-proof-required'],
      [{ enrolled: false }, 'not-enrolled'],
      [{ excluded: true }, 'excluded-address'],
      [{ payingInProgress: true }, 'claim-in-progress'],
      [{ lastClaimAtMs: Date.parse('2026-10-21T11:30:00Z') }, 'claim-rate-limited'],
      [{ claimableStroops: 0n }, 'nothing-claimable'],
      [{ claimableStroops: xlmToStroops('0.9999999') }, 'below-minimum'],
      [{ treasuryBalanceStroops: null }, 'treasury-unavailable'],
      [{ treasuryBalanceStroops: xlmToStroops('5.4999999') }, 'treasury-insufficient'], // 3.5 + 2 reserve = 5.5
    ];
    for (const [patch, reason] of cases) {
      expect(claimEligibility({ ...ok(), ...patch })).toEqual({ ok: false, reason });
    }
  });

  it('the rate limit is a rolling hour on the last claim of ANY status; exactly one hour later passes', () => {
    const f = ok();
    expect(claimEligibility({ ...f, lastClaimAtMs: f.nowMs - 3_600_000 + 1 })).toEqual({ ok: false, reason: 'claim-rate-limited' });
    expect(claimEligibility({ ...f, lastClaimAtMs: f.nowMs - 3_600_000 })).toEqual({ ok: true });
  });

  it('the treasury guard is balance ≥ total + reserve, exact to the stroop; the minimum is inclusive', () => {
    const f = ok();
    expect(claimEligibility({ ...f, treasuryBalanceStroops: xlmToStroops('5.5000000') })).toEqual({ ok: true });
    expect(claimEligibility({ ...f, claimableStroops: xlmToStroops(1) })).toEqual({ ok: true });
  });
});
