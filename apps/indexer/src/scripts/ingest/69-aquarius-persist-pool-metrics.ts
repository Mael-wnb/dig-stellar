import { loadJson, nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { getVenueBySlugOrThrow, getEntityBySlugOrThrow } from '../shared/lookup';

async function main() {
  const poolSnapshot = await loadJson<any>('60-aquarius-pool-snapshot-db-ready.json');
  if (!poolSnapshot) {
    throw new Error('Missing 60-aquarius-pool-snapshot-db-ready.json');
  }

  const entitySlug = poolSnapshot.entitySlug as string | undefined;
  if (!entitySlug) {
    throw new Error('Missing entitySlug in 60-aquarius-pool-snapshot-db-ready.json');
  }

  const client = createPgClient();
  await client.connect();

  try {
    const venue = await getVenueBySlugOrThrow(client, 'aquarius');
    const entity = await getEntityBySlugOrThrow(client, entitySlug);

    const pricesRes = await client.query(`
      select distinct on (ap.asset_id)
        ap.asset_id,
        ap.price_usd
      from asset_prices ap
      order by ap.asset_id, ap.observed_at desc
    `);

    const priceMap = new Map<string, number>(
      pricesRes.rows.map((row: { asset_id: string; price_usd: string }) => [
        row.asset_id,
        Number(row.price_usd),
      ])
    );

    const reserveRes = await client.query(
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

    for (const row of reserveRes.rows as Array<any>) {
      const price = priceMap.get(row.asset_id) ?? 0;
      const reserve = row.d_supply_scaled ? Number(row.d_supply_scaled) : 0;
      tvlUsd += reserve * price;
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
        0,
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        JSON.stringify({
          source: '69-aquarius-persist-pool-metrics',
          entitySlug,
          swaps24h: 0,
        }),
      ]
    );

    console.log({
      completedAt: asOf,
      entitySlug: entity.slug,
      tvlUsd,
      volume24hUsd: 0,
      fees24hUsd: 0,
      swaps24h: 0,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});