// apps/indexer/src/scripts/shared/prices.ts
import type { Client } from 'pg';

// Max age of a price row before it counts as absent. Same threshold as the venue
// freshness rule (FRESHNESS_STALE_AFTER_MINUTES, default 45): a row is normally
// 8–23 min old when read (15-min cadence, 7–8 min runs), 45 min = two missed runs.
// Phase A2 applies it to every reader; tonight step 2 uses it (price-sources v2).
export function priceMaxAgeMinutes(): number {
  const raw = Number(process.env.PRICE_MAX_AGE_MINUTES ?? process.env.FRESHNESS_STALE_AFTER_MINUTES ?? 45);
  return Number.isFinite(raw) && raw > 0 ? raw : 45;
}

// SQL fragment: "this asset_prices row is fresh". Every reader of asset_prices
// (indexer writers, wallet snapshots, step 2) appends it so a dead feed's last row
// counts as ABSENT instead of being served forever (price-sources v2, phase A2).
// The API applies the same rule (apps/api/src/common/freshness.ts).
export function freshPriceSql(alias = 'ap'): string {
  const minutes = Math.round(priceMaxAgeMinutes());
  return `${alias}.observed_at > now() - interval '${minutes} minutes'`;
}

export type PricedLeg = { amount: number | null; priceUsd: number | null };

// Pool TVL from priced legs: the sum of the priced ones, or NULL when no leg is
// priced (a pool whose reserves have no fresh price has no TVL, not a TVL of 0).
// A partially priced pool still sums what it can (documented follow-up).
export function tvlFromLegs(legs: PricedLeg[]): { tvlUsd: number | null; priced: number; total: number } {
  let sum = 0;
  let priced = 0;
  for (const leg of legs) {
    if (leg.amount === null || leg.priceUsd === null || !Number.isFinite(leg.amount) || !Number.isFinite(leg.priceUsd)) continue;
    sum += leg.amount * leg.priceUsd;
    priced += 1;
  }
  return { tvlUsd: legs.length > 0 && priced === 0 ? null : sum, priced, total: legs.length };
}

export async function getLatestAssetPricesMap(client: Client): Promise<Map<string, number>> {
  const res = await client.query(
    `
    select distinct on (ap.asset_id)
      ap.asset_id,
      ap.price_usd
    from asset_prices ap
    where ${freshPriceSql('ap')}
    order by ap.asset_id, ap.observed_at desc
    `
  );

  return new Map<string, number>(
    res.rows.map((row: { asset_id: string; price_usd: string }) => [
      row.asset_id,
      Number(row.price_usd),
    ])
  );
}

export function safeDivide(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

export function inferStablePrice(symbol: string): number | null {
  const s = symbol.toUpperCase();

  if (s === 'USDC') return 1;
  if (s === 'PYUSD') return 1;

  return null;
}