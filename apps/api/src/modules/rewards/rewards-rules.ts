// apps/api/src/modules/rewards/rewards-rules.ts
//
// Lot EP (EP5): PURE rewards rules — the daily allocation of the XLM pool by
// points, the claim decision, and the stroop arithmetic both rely on. No I/O,
// no Nest, no env: every fact arrives as an input so rewards-rules.spec.ts can
// exercise every branch (campaign-rules.ts / faucet-eligibility.ts pattern).
// The repository (allocation step) and the service (claim) gather the facts
// and run THESE functions — one decision procedure per rule.
//
// MONEY PATH. Every amount is handled as an integer number of stroops
// (1 XLM = 10,000,000 stroops) in BigInt — never a float — and rendered as a
// 7-decimal string for SQL (numeric(12, 7)) and for the Stellar SDK.
//
// Allocation (founder decision 2026-10-21): for a CLOSED UTC day D,
//   share(wallet) = min(floor(pool × points(wallet) / Σ points), cap)
// over the enrolled, non-excluded wallets with points > 0 on D. Floor keeps
// Σ shares ≤ pool; the undistributed remainder stays in the treasury. A day
// with Σ points = 0 is not allocated at all.

export const STROOPS_PER_XLM = 10_000_000n;
export const XLM_DECIMALS = 7;

const XLM_STRING_RE = /^(\d+)(?:\.(\d{1,7}))?$/;

/**
 * Exact XLM → stroops. Accepts a non-negative number (env values such as 100,
 * 5, 2.5 — rendered through toFixed(7) first) or a decimal string with at most
 * 7 decimals (what SQL returns for numeric(12, 7)::text). Throws on anything
 * else: a money amount that cannot be represented exactly must not be guessed.
 */
export function xlmToStroops(xlm: number | string): bigint {
  const text = typeof xlm === 'number' ? xlm.toFixed(XLM_DECIMALS) : xlm.trim();
  const m = XLM_STRING_RE.exec(text);
  if (!m || (typeof xlm === 'number' && !(Number.isFinite(xlm) && xlm >= 0))) {
    throw new Error(`invalid XLM amount: ${typeof xlm === 'number' ? xlm : JSON.stringify(xlm)}`);
  }
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? '').padEnd(XLM_DECIMALS, '0'));
  return whole * STROOPS_PER_XLM + frac;
}

/** Stroops → '123.4567890' (always 7 decimals; what SQL and the SDK receive). */
export function stroopsToXlm(stroops: bigint): string {
  if (stroops < 0n) throw new Error('negative stroops');
  const whole = stroops / STROOPS_PER_XLM;
  const frac = stroops % STROOPS_PER_XLM;
  return `${whole.toString()}.${frac.toString().padStart(XLM_DECIMALS, '0')}`;
}

/** Stroops → a JS number for payloads (7 decimals; exact for every realistic amount). */
export function stroopsToNumber(stroops: bigint): number {
  return Number(stroopsToXlm(stroops));
}

// ---------------------------------------------------------------------------
// Daily allocation
// ---------------------------------------------------------------------------

export interface DayPoints {
  address: string;
  /** Σ positive points_ledger.points with counted_day = the day (> 0). */
  points: number;
}

export interface AllocationInput {
  poolXlm: number;
  capXlm: number;
  /** Enrolled wallets with their points on the day (the repository joins enrolments). */
  points: ReadonlyArray<DayPoints>;
  /** Lower-cased excluded addresses (REWARDS_EXCLUDED_ADDRESSES): never allocated, never in the Σ. */
  excluded: ReadonlySet<string>;
}

export interface Allocation {
  address: string;
  pointsDay: number;
  shareStroops: bigint;
  /** 7-decimal string for SQL. */
  shareXlm: string;
}

export interface DayAllocation {
  /** Sorted by address (deterministic), zero shares dropped. */
  allocations: Allocation[];
  /** Σ points over the counted wallets (excluded wallets and non-positive rows removed). */
  totalPoints: number;
  /** Wallets dropped because excluded. */
  excludedWallets: number;
  /** Wallets whose share floored to 0 stroops (not inserted). */
  zeroShares: number;
  distributedStroops: bigint;
  /** pool − distributed: stays in the treasury. */
  remainderStroops: bigint;
  poolXlm: string;
  capXlm: string;
}

export function allocateDay(input: AllocationInput): DayAllocation {
  const poolStroops = xlmToStroops(input.poolXlm);
  const capStroops = xlmToStroops(input.capXlm);

  let excludedWallets = 0;
  const counted: DayPoints[] = [];
  for (const p of input.points) {
    if (!(Number.isInteger(p.points) && p.points > 0)) continue;
    if (input.excluded.has(p.address.toLowerCase())) {
      excludedWallets += 1;
      continue;
    }
    counted.push(p);
  }
  counted.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));

  const totalPoints = counted.reduce((sum, p) => sum + p.points, 0);
  const out: DayAllocation = {
    allocations: [],
    totalPoints,
    excludedWallets,
    zeroShares: 0,
    distributedStroops: 0n,
    remainderStroops: poolStroops,
    poolXlm: stroopsToXlm(poolStroops),
    capXlm: stroopsToXlm(capStroops),
  };
  if (totalPoints === 0) return out;

  const total = BigInt(totalPoints);
  for (const p of counted) {
    const raw = (poolStroops * BigInt(p.points)) / total; // BigInt division floors
    const share = raw < capStroops ? raw : capStroops;
    if (share === 0n) {
      out.zeroShares += 1;
      continue;
    }
    out.allocations.push({ address: p.address, pointsDay: p.points, shareStroops: share, shareXlm: stroopsToXlm(share) });
    out.distributedStroops += share;
  }
  out.remainderStroops = poolStroops - out.distributedStroops;
  return out;
}

/**
 * A closed UTC day ('YYYY-MM-DD') may be allocated once the clock is past its
 * end plus the grace: now ≥ (day + 1) 00:00Z + graceMs. Today is never closed.
 */
export function dayIsAllocatable(day: string, nowMs: number, graceMs: number): boolean {
  const end = new Date(`${day}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return nowMs >= end.getTime() + graceMs;
}

/** The ISO instant at which today's UTC day closes (nextCloseAt in /me). */
export function nextUtcMidnightIso(nowMs: number): string {
  const d = new Date(nowMs);
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Claim decision
// ---------------------------------------------------------------------------

export type ClaimIneligibleReason =
  | 'rewards-disabled'
  | 'ownership-proof-required'
  | 'not-enrolled'
  | 'excluded-address'
  | 'claim-in-progress'
  | 'claim-rate-limited'
  | 'nothing-claimable'
  | 'below-minimum'
  | 'treasury-unavailable'
  | 'treasury-insufficient';

export interface ClaimFacts {
  enabled: boolean;
  proven: boolean;
  enrolled: boolean;
  excluded: boolean;
  /** A 'paying' allocation exists for the wallet (a claim is mid-flight or stuck). */
  payingInProgress: boolean;
  /** created_at of the wallet's most recent claim (any status), or null. */
  lastClaimAtMs: number | null;
  nowMs: number;
  rateLimitMs: number;
  claimableStroops: bigint;
  minClaimStroops: bigint;
  /** Treasury NATIVE balance; null = unknown / unreachable / no key (never payable on a guess). */
  treasuryBalanceStroops: bigint | null;
  reserveStroops: bigint;
}

export type ClaimDecision = { ok: true } | { ok: false; reason: ClaimIneligibleReason };

export function claimEligibility(f: ClaimFacts): ClaimDecision {
  if (!f.enabled) return { ok: false, reason: 'rewards-disabled' };
  if (!f.proven) return { ok: false, reason: 'ownership-proof-required' };
  if (!f.enrolled) return { ok: false, reason: 'not-enrolled' };
  if (f.excluded) return { ok: false, reason: 'excluded-address' };
  if (f.payingInProgress) return { ok: false, reason: 'claim-in-progress' };
  if (f.lastClaimAtMs != null && f.nowMs - f.lastClaimAtMs < f.rateLimitMs) {
    return { ok: false, reason: 'claim-rate-limited' };
  }
  if (f.claimableStroops <= 0n) return { ok: false, reason: 'nothing-claimable' };
  if (f.claimableStroops < f.minClaimStroops) return { ok: false, reason: 'below-minimum' };
  if (f.treasuryBalanceStroops == null) return { ok: false, reason: 'treasury-unavailable' };
  if (f.treasuryBalanceStroops < f.claimableStroops + f.reserveStroops) {
    return { ok: false, reason: 'treasury-insufficient' };
  }
  return { ok: true };
}
