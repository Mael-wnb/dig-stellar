// apps/indexer/src/lib/protocols/xoxno/compute-pool-metrics.ts
//
// Hub metrics from the LATEST reserve_snapshots batch (one snapshot_at per
// refresh, written atomically by persist-hub-state) × fresh asset_prices.
//
// TVL definition (founder decision, Lot XO): tvl_usd = Σ cash × price over the
// PRICED markets — pool cash is what pool.get_reserves returns and what
// DefiLlama sums for XOXNO. Supplied and borrowed are reported separately
// (total_supplied_usd / total_borrowed_usd). Unpriced markets are EXCLUDED and
// counted (pricedMarkets / totalMarkets); nothing is ever priced at 1.
//
// Price selection: newest fresh row per asset, but a 'xoxno-aggregator' row
// (the scoped fallback) loses to any own-source row whatever its timestamp.
import type { Client, PoolClient } from 'pg';
import { freshPriceSql } from '../../../scripts/shared/prices';
import { getEntityBySlugOrThrow } from '../../../scripts/shared/lookup';
import { XOXNO_AGGREGATOR_PRICE_SOURCE, type XoxnoHubMetrics } from './types';

type DbClient = Pick<Client | PoolClient, 'query'>;

type PriceRow = { asset_id: string; price_usd: string; source: string };

type ReserveRow = {
  asset_id: string;
  symbol: string | null;
  d_supply_scaled: string | null;
  b_supply_scaled: string | null;
  supply_apr: number | string | null;
  est_supply_apy: number | string | null;
  borrow_apr: number | string | null;
  est_borrow_apy: number | string | null;
  metadata: { asset?: string; cash?: number | string; utilisation?: number | string } | null;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function computeXoxnoHubMetrics(params: { client: DbClient; entitySlug: string }): Promise<XoxnoHubMetrics> {
  const { client, entitySlug } = params;
  const entity = await getEntityBySlugOrThrow(client, entitySlug);

  const pricesRes = await client.query(
    `
    select distinct on (ap.asset_id) ap.asset_id, ap.price_usd, ap.source
    from asset_prices ap
    where ${freshPriceSql('ap')}
    order by ap.asset_id, (ap.source = $1) asc, ap.observed_at desc
    `,
    [XOXNO_AGGREGATOR_PRICE_SOURCE]
  );
  const prices = new Map<string, { priceUsd: number; source: string }>(
    (pricesRes.rows as PriceRow[]).map((r) => [r.asset_id, { priceUsd: Number(r.price_usd), source: r.source }])
  );

  const reserveRes = await client.query(
    `
    select rs.asset_id, rs.symbol, rs.d_supply_scaled, rs.b_supply_scaled,
           rs.supply_apr, rs.est_supply_apy, rs.borrow_apr, rs.est_borrow_apy, rs.metadata
    from reserve_snapshots rs
    where rs.entity_id = $1
      and rs.snapshot_at = (select max(rs2.snapshot_at) from reserve_snapshots rs2 where rs2.entity_id = $1)
    order by rs.symbol asc nulls last, rs.asset_id
    `,
    [entity.id]
  );
  const rows = reserveRes.rows as ReserveRow[];

  let tvl = 0;
  let totalSuppliedUsd = 0;
  let totalBorrowedUsd = 0;
  let supplyApyNumerator = 0;
  let borrowApyNumerator = 0;
  let pricedMarkets = 0;
  const unpricedMarkets: string[] = [];
  const reserveBreakdown: XoxnoHubMetrics['reserveBreakdown'] = [];

  for (const row of rows) {
    const price = prices.get(row.asset_id) ?? null;
    const supplied = num(row.b_supply_scaled) ?? 0; // Blend convention: b_* = supplied
    const borrowed = num(row.d_supply_scaled) ?? 0; // d_* = borrowed
    const cash = num(row.metadata?.cash) ?? 0;
    const supplyApy = num(row.est_supply_apy);
    const borrowApy = num(row.est_borrow_apy);

    const cashUsd = price ? cash * price.priceUsd : null;
    const suppliedUsd = price ? supplied * price.priceUsd : null;
    const borrowedUsd = price ? borrowed * price.priceUsd : null;

    if (price) {
      pricedMarkets += 1;
      tvl += cashUsd ?? 0;
      totalSuppliedUsd += suppliedUsd ?? 0;
      totalBorrowedUsd += borrowedUsd ?? 0;
      if (suppliedUsd !== null && supplyApy !== null) supplyApyNumerator += suppliedUsd * supplyApy;
      if (borrowedUsd !== null && borrowApy !== null) borrowApyNumerator += borrowedUsd * borrowApy;
    } else {
      unpricedMarkets.push(row.symbol ?? row.asset_id);
    }

    reserveBreakdown.push({
      assetId: row.asset_id,
      asset: row.metadata?.asset ?? null,
      symbol: row.symbol,
      priceUsd: price?.priceUsd ?? null,
      priceSource: price?.source ?? null,
      cash,
      cashUsd,
      supplied,
      suppliedUsd,
      borrowed,
      borrowedUsd,
      utilisation: num(row.metadata?.utilisation),
      supplyApr: num(row.supply_apr),
      supplyApy,
      borrowApr: num(row.borrow_apr),
      borrowApy,
    });
  }

  const nothingPriced = rows.length > 0 && pricedMarkets === 0;

  return {
    tvlUsd: nothingPriced ? null : tvl,
    totalSuppliedUsd,
    totalBorrowedUsd,
    netLiquidityUsd: nothingPriced ? null : totalSuppliedUsd - totalBorrowedUsd,
    weightedSupplyApy: totalSuppliedUsd > 0 ? supplyApyNumerator / totalSuppliedUsd : null,
    weightedBorrowApy: totalBorrowedUsd > 0 ? borrowApyNumerator / totalBorrowedUsd : null,
    pricedMarkets,
    totalMarkets: rows.length,
    unpricedMarkets,
    reserveBreakdown,
  };
}
