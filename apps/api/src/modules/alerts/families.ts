// apps/api/src/modules/alerts/families.ts
//
// Lot N — pure family dispatch + price-notification copy. The evaluator run
// (script 83) must never feed a rule to the wrong family's evaluator: a price
// rule matched against health rows would compare a USD price to a health-factor
// threshold. partitionRulesByFamily() is the single dispatch point; rules whose
// metric has no evaluator yet land in `unknown` and are skipped (honesty rule:
// a family is creatable IFF its evaluator actually runs — unknown metrics can
// only appear if the DB gets ahead of the code, and then we skip loudly).

export type AlertFamily = 'health_factor' | 'price' | 'tvl_drop_pct';

export type FamilyPartition<T> = {
  healthFactor: T[];
  price: T[];
  tvlDrop: T[];
  unknown: T[];
};

export function partitionRulesByFamily<T extends { metric: string }>(
  rules: T[],
): FamilyPartition<T> {
  const out: FamilyPartition<T> = {
    healthFactor: [],
    price: [],
    tvlDrop: [],
    unknown: [],
  };
  for (const rule of rules) {
    if (rule.metric === 'health_factor') out.healthFactor.push(rule);
    else if (rule.metric === 'price') out.price.push(rule);
    else if (rule.metric === 'tvl_drop_pct') out.tvlDrop.push(rule);
    else out.unknown.push(rule);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Price copy — observed value + as_of, per the alerting honesty rules
// ("XLM crossed above $0.17 — $0.1712 at 14:32 UTC", never "your alert fired").
// ---------------------------------------------------------------------------

// USD price formatting: >= $1 → 2 decimals; < $1 → 4 decimals (sub-dollar
// assets like XLM need the extra precision to be meaningful).
export function formatUsdPrice(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  return Math.abs(value) >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

// "14:32 UTC" when the observation is < 24h old relative to `now`, else the
// full "2026-08-14 09:10 UTC" — an old as_of must be visibly old.
export function formatAsOf(asOf: Date, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(asOf.getUTCHours())}:${pad(asOf.getUTCMinutes())} UTC`;
  const ageMs = now.getTime() - asOf.getTime();
  if (ageMs >= 0 && ageMs < 24 * 3600 * 1000) return hm;
  return `${asOf.getUTCFullYear()}-${pad(asOf.getUTCMonth() + 1)}-${pad(asOf.getUTCDate())} ${hm}`;
}

export type PriceCopyInput = {
  emit: 'alert_fired' | 'alert_resolved';
  symbol: string; // display symbol, e.g. "XLM"
  operator: 'lt' | 'lte' | 'gt' | 'gte';
  threshold: number;
  value: number; // observed price (full precision — rounded only for display)
  asOf: Date; // asset_prices.observed_at of the observed value
  now: Date;
};

export function buildPriceCopy(input: PriceCopyInput): {
  title: string;
  body: string;
} {
  const { emit, symbol, operator, threshold, value, asOf, now } = input;
  const highIsBreach = operator === 'gt' || operator === 'gte';
  const t = formatUsdPrice(threshold);
  const v = formatUsdPrice(value);
  const at = formatAsOf(asOf, now);

  if (emit === 'alert_fired') {
    const dir = highIsBreach ? 'above' : 'below';
    return {
      title: `Price alert: ${symbol} ${dir} ${t}`,
      body: `${symbol} crossed ${dir} ${t} — ${v} at ${at}.`,
    };
  }
  // Resolved: the price came back through the threshold in the other direction.
  const backDir = highIsBreach ? 'below' : 'above';
  return {
    title: `Price alert resolved: ${symbol} back ${backDir} ${t}`,
    body: `${symbol} is back ${backDir} ${t} — ${v} at ${at}.`,
  };
}

// ---------------------------------------------------------------------------
// TVL-drop family (N3) — pool TVL drop % over the ~24h batch window.
// The OBSERVED VALUE the state machine evaluates is the drop percentage:
// positive = TVL fell, negative = TVL grew. A rule (operator gte, threshold X)
// breaches when the drop crosses X% and resolves when it comes back within.
// ---------------------------------------------------------------------------

// Drop % between the two batch TVLs. null when the previous TVL is not a
// usable base (zero/negative — a percentage of nothing is meaningless).
export function computeTvlDropPct(
  prevTvlUsd: number,
  latestTvlUsd: number,
): number | null {
  if (!Number.isFinite(prevTvlUsd) || !Number.isFinite(latestTvlUsd)) return null;
  if (prevTvlUsd <= 0) return null;
  return ((prevTvlUsd - latestTvlUsd) / prevTvlUsd) * 100;
}

// Compact USD for TVL copy: $8.0M / $950.3K / $12.40.
export function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

// Signed drop for display: drop 12.4 → "−12.4%", drop -3.2 (growth) → "+3.2%".
export function formatDropPct(dropPct: number): string {
  const abs = Math.abs(dropPct).toFixed(1);
  return dropPct >= 0 ? `−${abs}%` : `+${abs}%`;
}

export type TvlDropCopyInput = {
  emit: 'alert_fired' | 'alert_resolved';
  poolLabel: string;
  dropPct: number;
  prevTvlUsd: number;
  latestTvlUsd: number;
  thresholdPct: number;
  windowHours: number; // ACTUAL hours between the two batches (honesty)
  asOf: Date; // latest batch snapshot_at
  now: Date;
};

// "Blend Fixed TVL −12.4% over 24h ($8.0M → $7.0M) — as of 14:32 UTC."
export function buildTvlDropCopy(input: TvlDropCopyInput): {
  title: string;
  body: string;
} {
  const {
    emit,
    poolLabel,
    dropPct,
    prevTvlUsd,
    latestTvlUsd,
    thresholdPct,
    windowHours,
    asOf,
    now,
  } = input;
  const move = `${formatDropPct(dropPct)} over ${windowHours}h`;
  const range = `${formatUsdCompact(prevTvlUsd)} → ${formatUsdCompact(latestTvlUsd)}`;
  const at = formatAsOf(asOf, now);

  if (emit === 'alert_fired') {
    return {
      title: `TVL drop: ${poolLabel} ${move}`,
      body: `${poolLabel} TVL ${move} (${range}) — as of ${at}.`,
    };
  }
  return {
    title: `TVL drop resolved: ${poolLabel} back within ${thresholdPct}%`,
    body: `${poolLabel} TVL is back within your ${thresholdPct}% threshold: ${move} (${range}) — as of ${at}.`,
  };
}

// ---------------------------------------------------------------------------
// Pool-status family (N2) — automatic protection, no user rule. Pure edge logic
// over the A5b-derived status label (derivePoolStatus in actions.service.ts is
// the single source of the code→label mapping; this module only compares labels).
// ---------------------------------------------------------------------------

export type PoolStatusOutcome =
  | 'seed' // first observation of this pool — record state, NEVER notify
  | 'unchanged' // same label as last seen — silent
  | 'changed' // real transition between two known labels — notify
  | 'suppressed'; // transition involving 'Unknown' — record, never notify
  // ('Unknown' is a data/RPC anomaly, not a pool event — notifying would be noise)

export function diffPoolStatus(
  prev: string | null,
  current: string
): PoolStatusOutcome {
  if (prev === null) return 'seed';
  if (prev === current) return 'unchanged';
  if (prev === 'Unknown' || current === 'Unknown') return 'suppressed';
  return 'changed';
}

// What each status means for the user's actions — mirrors derivePoolStatus /
// the contract's require_action_allowed (withdraw is NEVER status-blocked).
const POOL_STATUS_CONSEQUENCE: Record<string, string> = {
  Active: 'All actions are available again.',
  'On-Ice': 'Borrowing is disabled; supplies and withdrawals remain available.',
  Frozen: 'Supplies and borrowing are disabled; withdrawals remain available.',
  Setup: 'The pool is in setup; supplies and borrowing are disabled, withdrawals remain available.',
};

export type PoolStatusCopy = {
  kind: 'alert_fired' | 'alert_resolved';
  title: string;
  body: string;
};

// "Blend YieldBlox pool status changed: Active → Frozen. Supplies and borrowing
// are disabled; withdrawals remain available." Back to Active reads as a resolve.
export function buildPoolStatusCopy(input: {
  poolLabel: string;
  from: string;
  to: string;
}): PoolStatusCopy {
  const { poolLabel, from, to } = input;
  const backToActive = to === 'Active';
  const consequence = POOL_STATUS_CONSEQUENCE[to] ?? '';
  return {
    kind: backToActive ? 'alert_resolved' : 'alert_fired',
    title: backToActive
      ? `Pool status: ${poolLabel} is Active again`
      : `Pool status: ${poolLabel} is now ${to}`,
    body: `${poolLabel} pool status changed: ${from} → ${to}.${consequence ? ` ${consequence}` : ''}`,
  };
}

// assets.symbol stores the Stellar-native lumen as 'native'; display it as XLM.
export function displaySymbol(
  symbol: string | null,
  name: string | null,
  assetId: string,
): string {
  const s = (symbol ?? '').trim();
  if (s === 'native') return 'XLM';
  if (s) return s;
  const n = (name ?? '').trim();
  if (n) return n;
  return `asset ${assetId.slice(0, 8)}`;
}
