// apps/indexer/src/lib/protocols/aquarius/persist-pool-metrics.ts
import type { Client, PoolClient } from 'pg';
import { nowIso } from '../../../scripts/discovery/00-common';
import {
  getEntityBySlugOrThrow,
  getVenueBySlugOrThrow,
} from '../../../scripts/shared/lookup';
import { AquariusPoolMetrics } from './types';

type DbClient = Pick<Client | PoolClient, 'query'>;

type LatestPriceRow = {
  asset_id: string;
  price_usd: string;
};

type ReserveSnapshotRow = {
  asset_id: string;
  d_supply_scaled: string | null;
};

type NormalizedEventRow = {
  event_key: string | null;
  token_in_asset_id: string | null;
  token_out_asset_id: string | null;
  token_amount_in_scaled: string | null;
  token_amount_out_scaled: string | null;
  metadata: Record<string, unknown> | null;
};

function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function persistAquariusPoolMetrics(params: {
  client: DbClient;
  entitySlug: string;
  expectedPoolId: string;
}): Promise<AquariusPoolMetrics & { completedAt: string; entitySlug: string }> {
  const { client, entitySlug, expectedPoolId } = params;

  const venue = await getVenueBySlugOrThrow(client, 'aquarius');
  const entity = await getEntityBySlugOrThrow(client, entitySlug);

  if (entity.contract_address !== expectedPoolId) {
    throw new Error(
      `Entity contract_address mismatch for ${entitySlug}: ${entity.contract_address} !== ${expectedPoolId}`
    );
  }

  const pricesRes = await client.query<LatestPriceRow>(`
    select distinct on (ap.asset_id)
      ap.asset_id,
      ap.price_usd
    from asset_prices ap
    order by ap.asset_id, ap.observed_at desc
  `);

  const priceMap = new Map<string, number>(
    pricesRes.rows.map((row) => [row.asset_id, Number(row.price_usd)])
  );

  const reserveRes = await client.query<ReserveSnapshotRow>(
    `
    select distinct on (rs.asset_id)
      rs.asset_id,
      rs.d_supply_scaled
    from reserve_snapshots rs
    where rs.entity_id = $1
    order by rs.asset_id, rs.snapshot_at desc, rs.created_at desc
    `,
    [entity.id]
  );

  let tvlUsd = 0;

  for (const row of reserveRes.rows) {
    const price = priceMap.get(row.asset_id) ?? 0;
    const reserve = row.d_supply_scaled ? Number(row.d_supply_scaled) : 0;
    tvlUsd += reserve * price;
  }

  const eventsRes = await client.query<NormalizedEventRow>(
    `
    select
      ne.event_key,
      ne.token_in_asset_id,
      ne.token_out_asset_id,
      ne.token_amount_in_scaled,
      ne.token_amount_out_scaled,
      ne.metadata
    from normalized_events ne
    where ne.entity_id = $1
      and ne.occurred_at >= now() - interval '24 hours'
    order by ne.occurred_at desc
    `,
    [entity.id]
  );

  let swaps24h = 0;
  let volume24hUsd = 0;
  let fees24hUsd = 0;

  for (const row of eventsRes.rows) {
    if (row.event_key !== 'AquariusPool:trade') continue;

    swaps24h += 1;

    const tokenInPrice =
      row.token_in_asset_id && priceMap.has(row.token_in_asset_id)
        ? priceMap.get(row.token_in_asset_id) ?? 0
        : 0;

    const tokenOutPrice =
      row.token_out_asset_id && priceMap.has(row.token_out_asset_id)
        ? priceMap.get(row.token_out_asset_id) ?? 0
        : 0;

    const amountIn = row.token_amount_in_scaled ? Number(row.token_amount_in_scaled) : 0;
    const amountOut = row.token_amount_out_scaled ? Number(row.token_amount_out_scaled) : 0;

    const amountInUsd = amountIn * tokenInPrice;
    const amountOutUsd = amountOut * tokenOutPrice;

    volume24hUsd += Math.max(amountInUsd, amountOutUsd);

    const metadata =
      row.metadata && typeof row.metadata === 'object' ? row.metadata : {};

    const feeAmountScaled = toFiniteNumber(
      (metadata as Record<string, unknown>).feeAmountScaled
    );

    if (feeAmountScaled > 0) {
      fees24hUsd += feeAmountScaled * tokenInPrice;
    }
  }

  const asOf = nowIso();

  await client.query(
    `
    insert into pool_metrics_latest (
      venue_id,
      entity_id,
      as_of,
      metric_type,
      tvl_usd,
      volume_24h_usd,
      fees_24h_usd,
      total_supplied_usd,
      total_borrowed_usd,
      net_liquidity_usd,
      total_backstop_credit_usd,
      weighted_supply_apy,
      weighted_borrow_apy,
      metadata
    )
    values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb
    )
    on conflict (entity_id, metric_type)
    do update set
      as_of = excluded.as_of,
      tvl_usd = excluded.tvl_usd,
      volume_24h_usd = excluded.volume_24h_usd,
      fees_24h_usd = excluded.fees_24h_usd,
      total_supplied_usd = excluded.total_supplied_usd,
      total_borrowed_usd = excluded.total_borrowed_usd,
      net_liquidity_usd = excluded.net_liquidity_usd,
      total_backstop_credit_usd = excluded.total_backstop_credit_usd,
      weighted_supply_apy = excluded.weighted_supply_apy,
      weighted_borrow_apy = excluded.weighted_borrow_apy,
      metadata = excluded.metadata,
      updated_at = now()
    `,
    [
      venue.id,
      entity.id,
      asOf,
      'latest',
      tvlUsd,
      volume24hUsd,
      fees24hUsd,
      null,
      null,
      null,
      null,
      null,
      null,
      JSON.stringify({
        source: 'lib/protocols/aquarius/persist-pool-metrics',
        entitySlug,
        poolId: expectedPoolId,
        swaps24h,
      }),
    ]
  );

  return {
    completedAt: asOf,
    entitySlug,
    tvlUsd,
    volume24hUsd,
    fees24hUsd,
    swaps24h,
  };
}