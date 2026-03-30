// apps/indexer/src/lib/protocols/blend/compute-pool-metrics.ts
import type { Client, PoolClient } from 'pg';
import { getEntityBySlugOrThrow } from '../../../scripts/shared/lookup';
import { BlendPoolMetrics, BlendReserveMetricRow } from './types';

type DbClient = Pick<Client | PoolClient, 'query'>;

type LatestPriceRow = {
  asset_id: string;
  price_usd: string | number;
};

type ReserveSnapshotRow = {
  asset_id: string;
  symbol: string | null;
  name: string | null;
  d_supply_scaled: string | number | null;
  b_supply_scaled: string | number | null;
  backstop_credit_scaled: string | number | null;
  est_supply_apy: string | number | null;
  est_borrow_apy: string | number | null;
};

function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function computeBlendPoolMetrics(params: {
  client: DbClient;
  entitySlug: string;
}): Promise<BlendPoolMetrics> {
  const { client, entitySlug } = params;

  const entity = await getEntityBySlugOrThrow(client, entitySlug);

  const pricesRes = await client.query(
    `
    select distinct on (ap.asset_id)
      ap.asset_id,
      ap.price_usd
    from asset_prices ap
    order by ap.asset_id, ap.observed_at desc
    `
  );

  const priceMap = new Map<string, number>(
    (pricesRes.rows as LatestPriceRow[]).map((row) => [
      row.asset_id,
      toFiniteNumber(row.price_usd),
    ])
  );

  const reserveRes = await client.query(
    `
    select
      rs.asset_id,
      rs.symbol,
      rs.name,
      rs.d_supply_scaled,
      rs.b_supply_scaled,
      rs.backstop_credit_scaled,
      rs.est_supply_apy,
      rs.est_borrow_apy
    from reserve_snapshots rs
    where rs.entity_id = $1
    `,
    [entity.id]
  );

  const reserveBreakdown: BlendReserveMetricRow[] = [];
  let totalSuppliedUsd = 0;
  let totalBorrowedUsd = 0;
  let totalBackstopCreditUsd = 0;
  let weightedSupplyApyNumerator = 0;
  let weightedBorrowApyNumerator = 0;

  for (const row of reserveRes.rows as ReserveSnapshotRow[]) {
    const priceUsd = priceMap.has(row.asset_id) ? priceMap.get(row.asset_id)! : null;

    const supplied = toFiniteNumber(row.d_supply_scaled);
    const borrowed = toFiniteNumber(row.b_supply_scaled);
    const backstopCredit = toFiniteNumber(row.backstop_credit_scaled);

    const supplyApy =
      row.est_supply_apy === null || row.est_supply_apy === undefined
        ? null
        : toFiniteNumber(row.est_supply_apy);

    const borrowApy =
      row.est_borrow_apy === null || row.est_borrow_apy === undefined
        ? null
        : toFiniteNumber(row.est_borrow_apy);

    const safePrice = priceUsd ?? 0;
    const suppliedUsd = supplied * safePrice;
    const borrowedUsd = borrowed * safePrice;
    const backstopCreditUsd = backstopCredit * safePrice;

    totalSuppliedUsd += suppliedUsd;
    totalBorrowedUsd += borrowedUsd;
    totalBackstopCreditUsd += backstopCreditUsd;

    if (supplyApy !== null) {
      weightedSupplyApyNumerator += suppliedUsd * supplyApy;
    }

    if (borrowApy !== null) {
      weightedBorrowApyNumerator += borrowedUsd * borrowApy;
    }

    reserveBreakdown.push({
      assetId: row.asset_id,
      symbol: row.symbol,
      name: row.name,
      priceUsd,
      supplied,
      borrowed,
      backstopCredit,
      supplyApy,
      borrowApy,
      suppliedUsd,
      borrowedUsd,
      backstopCreditUsd,
    });
  }

  const weightedSupplyApy =
    totalSuppliedUsd > 0 ? weightedSupplyApyNumerator / totalSuppliedUsd : null;

  const weightedBorrowApy =
    totalBorrowedUsd > 0 ? weightedBorrowApyNumerator / totalBorrowedUsd : null;

  return {
    entitySlug,
    tvlUsd: totalSuppliedUsd,
    totalSuppliedUsd,
    totalBorrowedUsd,
    totalBackstopCreditUsd,
    netLiquidityUsd: totalSuppliedUsd - totalBorrowedUsd,
    weightedSupplyApy,
    weightedBorrowApy,
    reserveBreakdown,
  };
}