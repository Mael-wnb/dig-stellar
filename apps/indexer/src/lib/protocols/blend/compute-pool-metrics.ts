// apps/indexer/src/lib/protocols/blend/compute-pool-metrics.ts

import type { Client, PoolClient } from 'pg';
import { getEntityBySlugOrThrow } from '../../../scripts/shared/lookup';
import { BlendPoolMetrics } from './types';

type DbClient = Pick<Client | PoolClient, 'query'>;

type LatestPriceRow = {
  asset_id: string;
  price_usd: string;
};

type ReserveSnapshotRow = {
  asset_id: string;
  symbol: string | null;
  name: string | null;
  d_supply_scaled: string | null;
  b_supply_scaled: string | null;
  backstop_credit_scaled: string | null;
  supply_apr: number | string | null;
  est_supply_apy: number | string | null;
  borrow_apr: number | string | null;
  est_borrow_apy: number | string | null;
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
    (pricesRes.rows as LatestPriceRow[]).map((row) => [row.asset_id, Number(row.price_usd)])
  );

  const reserveRes = await client.query(
    `
    select distinct on (rs.asset_id)
      rs.asset_id,
      rs.symbol,
      rs.name,
      rs.d_supply_scaled,
      rs.b_supply_scaled,
      rs.backstop_credit_scaled,
      rs.supply_apr,
      rs.est_supply_apy,
      rs.borrow_apr,
      rs.est_borrow_apy
    from reserve_snapshots rs
    where rs.entity_id = $1
    order by rs.asset_id, rs.snapshot_at desc, rs.created_at desc
    `,
    [entity.id]
  );

  let totalSuppliedUsd = 0;
  let totalBorrowedUsd = 0;
  let totalBackstopCreditUsd = 0;
  let weightedSupplyApyNumerator = 0;
  let weightedBorrowApyNumerator = 0;

  const reserveBreakdown: BlendPoolMetrics['reserveBreakdown'] = [];

  for (const row of reserveRes.rows as ReserveSnapshotRow[]) {
    const priceUsd = priceMap.has(row.asset_id) ? priceMap.get(row.asset_id) ?? null : null;

    const supplied = toFiniteNumber(row.d_supply_scaled);
    const borrowed = toFiniteNumber(row.b_supply_scaled);
    const backstopCredit = toFiniteNumber(row.backstop_credit_scaled);

    const suppliedUsd = priceUsd !== null ? supplied * priceUsd : null;
    const borrowedUsd = priceUsd !== null ? borrowed * priceUsd : null;
    const backstopCreditUsd = priceUsd !== null ? backstopCredit * priceUsd : null;

    if (suppliedUsd !== null) totalSuppliedUsd += suppliedUsd;
    if (borrowedUsd !== null) totalBorrowedUsd += borrowedUsd;
    if (backstopCreditUsd !== null) totalBackstopCreditUsd += backstopCreditUsd;

    const supplyApy = row.est_supply_apy !== null ? toFiniteNumber(row.est_supply_apy) : null;
    const borrowApy = row.est_borrow_apy !== null ? toFiniteNumber(row.est_borrow_apy) : null;

    if (suppliedUsd !== null && supplyApy !== null) {
      weightedSupplyApyNumerator += suppliedUsd * supplyApy;
    }

    if (borrowedUsd !== null && borrowApy !== null) {
      weightedBorrowApyNumerator += borrowedUsd * borrowApy;
    }

    reserveBreakdown.push({
      assetId: row.asset_id,
      symbol: row.symbol,
      name: row.name,
      priceUsd,
      supplied,
      suppliedUsd,
      borrowed,
      borrowedUsd,
      backstopCredit,
      backstopCreditUsd,
      supplyApr: row.supply_apr !== null ? toFiniteNumber(row.supply_apr) : null,
      supplyApy,
      borrowApr: row.borrow_apr !== null ? toFiniteNumber(row.borrow_apr) : null,
      borrowApy,
    });
  }

  const weightedSupplyApy =
    totalSuppliedUsd > 0 ? weightedSupplyApyNumerator / totalSuppliedUsd : null;

  const weightedBorrowApy =
    totalBorrowedUsd > 0 ? weightedBorrowApyNumerator / totalBorrowedUsd : null;

  return {
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