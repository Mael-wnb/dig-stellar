// apps/api/src/modules/alerts/families.ts
//
// Lot N — pure family dispatch + price-notification copy. The evaluator run
// (script 83) must never feed a rule to the wrong family's evaluator: a price
// rule matched against health rows would compare a USD price to a health-factor
// threshold. partitionRulesByFamily() is the single dispatch point; rules whose
// metric has no evaluator yet land in `unknown` and are skipped (honesty rule:
// a family is creatable IFF its evaluator actually runs — unknown metrics can
// only appear if the DB gets ahead of the code, and then we skip loudly).

export type AlertFamily = 'health_factor' | 'price';

export type FamilyPartition<T> = {
  healthFactor: T[];
  price: T[];
  unknown: T[];
};

export function partitionRulesByFamily<T extends { metric: string }>(
  rules: T[],
): FamilyPartition<T> {
  const out: FamilyPartition<T> = { healthFactor: [], price: [], unknown: [] };
  for (const rule of rules) {
    if (rule.metric === 'health_factor') out.healthFactor.push(rule);
    else if (rule.metric === 'price') out.price.push(rule);
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
