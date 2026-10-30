// apps/indexer/src/lib/protocols/xoxno/persist-pool-metrics.ts
//
// pool_metrics_latest row for one XOXNO hub (metric_type 'latest'), same
// conflict target and column set as blend/persist-pool-metrics.ts so step 70
// (protocol rollup) and /v1/pools pick it up unchanged.
import type { Client, PoolClient } from 'pg';
import { nowIso } from '../../../scripts/discovery/00-common';
import { getEntityBySlugOrThrow, getVenueBySlugOrThrow } from '../../../scripts/shared/lookup';
import { computeXoxnoHubMetrics } from './compute-pool-metrics';
import { XOXNO_VENUE_SLUG } from './types';

type DbClient = Pick<Client | PoolClient, 'query'>;

export async function persistXoxnoHubMetrics(params: { client: DbClient; entitySlug: string }) {
  const { client, entitySlug } = params;

  const venue = await getVenueBySlugOrThrow(client, XOXNO_VENUE_SLUG);
  const entity = await getEntityBySlugOrThrow(client, entitySlug);
  const metrics = await computeXoxnoHubMetrics({ client, entitySlug });
  const asOf = nowIso();

  await client.query(
    `
    insert into pool_metrics_latest (
      venue_id, entity_id, as_of, metric_type,
      tvl_usd, volume_24h_usd, fees_24h_usd,
      total_supplied_usd, total_borrowed_usd, net_liquidity_usd, total_backstop_credit_usd,
      weighted_supply_apy, weighted_borrow_apy, metadata
    )
    values ($1,$2,$3,$4,$5,null,null,$6,$7,$8,null,$9,$10,$11::jsonb)
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
      metrics.totalSuppliedUsd,
      metrics.totalBorrowedUsd,
      metrics.netLiquidityUsd,
      metrics.weightedSupplyApy,
      metrics.weightedBorrowApy,
      JSON.stringify({
        source: 'lib/protocols/xoxno/persist-pool-metrics',
        note: 'tvl_usd = Σ pool cash (get_reserves) × price over priced markets (DefiLlama-consistent); supplied/borrowed reported separately; unpriced markets excluded, never priced at 1',
        pricedMarkets: metrics.pricedMarkets,
        totalMarkets: metrics.totalMarkets,
        unpricedMarkets: metrics.unpricedMarkets,
        reserveBreakdown: metrics.reserveBreakdown,
      }),
    ]
  );

  return {
    completedAt: asOf,
    entitySlug,
    tvlUsd: metrics.tvlUsd,
    totalSuppliedUsd: metrics.totalSuppliedUsd,
    totalBorrowedUsd: metrics.totalBorrowedUsd,
    netLiquidityUsd: metrics.netLiquidityUsd,
    weightedSupplyApy: metrics.weightedSupplyApy,
    weightedBorrowApy: metrics.weightedBorrowApy,
    pricedMarkets: metrics.pricedMarkets,
    totalMarkets: metrics.totalMarkets,
    unpricedMarkets: metrics.unpricedMarkets,
  };
}
