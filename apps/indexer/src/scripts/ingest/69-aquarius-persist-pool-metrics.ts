// src/scripts/ingest/69-aquarius-persist-pool-metrics.ts
import { loadJson, nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { getEntityBySlugOrThrow, getVenueBySlugOrThrow } from '../shared/lookup';

type LatestPriceRow = {
  asset_id: string;
  price_usd: string;
};

type ReserveSnapshotRow = {
  asset_id: string;
  d_supply_scaled: string | null;
  snapshot_at: string;
};

type NormalizedEventRow = {
  event_key: string | null;
  token_in_asset_id: string | null;
  token_out_asset_id: string | null;
  token_amount_in_scaled: string | null;
  token_amount_out_scaled: string | null;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
};

function resolveEntitySlug(params: {
  envEntitySlug: string | undefined;
  registry: any;
  poolSnapshot: any;
}): string {
  const entitySlug =
    params.envEntitySlug ??
    params.registry?.pool?.entitySlug ??
    params.poolSnapshot?.entitySlug;

  if (!entitySlug || typeof entitySlug !== 'string') {
    throw new Error(
      'Missing entitySlug. Checked ENTITY_SLUG env, 59-aquarius-final-registry.json, and 60-aquarius-pool-snapshot-db-ready.json'
    );
  }

  return entitySlug;
}

function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  // src/scripts/discovery/59-aquarius-final-registry.ts
  const registry = await loadJson<any>('59-aquarius-final-registry.json');

  // src/scripts/discovery/60-aquarius-pool-snapshot-db-ready.ts
  const poolSnapshot = await loadJson<any>('60-aquarius-pool-snapshot-db-ready.json');

  if (!registry) {
    throw new Error('Missing 59-aquarius-final-registry.json');
  }

  if (!poolSnapshot) {
    throw new Error('Missing 60-aquarius-pool-snapshot-db-ready.json');
  }

  const envEntitySlug = process.env.ENTITY_SLUG;
  const envPoolId = process.env.AQUARIUS_POOL_ID;

  const entitySlug = resolveEntitySlug({
    envEntitySlug,
    registry,
    poolSnapshot,
  });

  const registryPoolId =
    typeof registry?.pool?.poolId === 'string' ? registry.pool.poolId : null;

  if (envPoolId && registryPoolId && envPoolId !== registryPoolId) {
    throw new Error(
      `Mismatch between AQUARIUS_POOL_ID and 59 poolId: ${envPoolId} !== ${registryPoolId}`
    );
  }

  const client = createPgClient();
  await client.connect();

  try {
    const venue = await getVenueBySlugOrThrow(client, 'aquarius');
    const entity = await getEntityBySlugOrThrow(client, entitySlug);

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
        rs.d_supply_scaled,
        rs.snapshot_at
      from reserve_snapshots rs
      join entities e on e.id = rs.entity_id
      where e.slug = $1
      order by rs.asset_id, rs.snapshot_at desc
      `,
      [entitySlug]
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
        ne.occurred_at,
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
          source: '69-aquarius-persist-pool-metrics',
          entitySlug,
          poolId: registryPoolId,
          swaps24h,
        }),
      ]
    );

    console.log({
      completedAt: asOf,
      entitySlug: entity.slug,
      tvlUsd,
      volume24hUsd,
      fees24hUsd,
      swaps24h,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});