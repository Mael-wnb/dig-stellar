// apps/indexer/src/lib/protocols/blend/persist-pool-metrics.ts
import type { Client, PoolClient } from 'pg';
import { nowIso } from '../../../scripts/discovery/00-common';
import {
  getEntityBySlugOrThrow,
  getVenueBySlugOrThrow,
} from '../../../scripts/shared/lookup';
import { computeBlendPoolMetrics } from './compute-pool-metrics';

type DbClient = Pick<Client | PoolClient, 'query'>;

export async function persistBlendPoolMetrics(params: {
  client: DbClient;
  entitySlug: string;
}) {
  const { client, entitySlug } = params;

  const venue = await getVenueBySlugOrThrow(client, 'blend');
  const entity = await getEntityBySlugOrThrow(client, entitySlug);

  const metrics = await computeBlendPoolMetrics({
    client,
    entitySlug,
  });

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
      metrics.tvlUsd,
      null,
      null,
      metrics.totalSuppliedUsd,
      metrics.totalBorrowedUsd,
      metrics.netLiquidityUsd,
      metrics.totalBackstopCreditUsd,
      metrics.weightedSupplyApy,
      metrics.weightedBorrowApy,
      JSON.stringify({
        source: 'lib/protocols/blend/persist-pool-metrics',
        entitySlug: metrics.entitySlug,
        note: 'For Blend lending pools, tvlUsd currently mirrors totalSuppliedUsd',
        reserveBreakdown: metrics.reserveBreakdown,
      }),
    ]
  );

  return {
    completedAt: asOf,
    entitySlug: metrics.entitySlug,
    tvlUsd: metrics.tvlUsd,
    totalSuppliedUsd: metrics.totalSuppliedUsd,
    totalBorrowedUsd: metrics.totalBorrowedUsd,
    totalBackstopCreditUsd: metrics.totalBackstopCreditUsd,
    netLiquidityUsd: metrics.netLiquidityUsd,
    weightedSupplyApy: metrics.weightedSupplyApy,
    weightedBorrowApy: metrics.weightedBorrowApy,
  };
}