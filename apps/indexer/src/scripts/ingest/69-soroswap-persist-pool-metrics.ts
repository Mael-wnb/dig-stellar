import { createPgClient } from '../shared/db';
import { getVenueBySlugOrThrow, getEntityBySlugOrThrow } from '../shared/lookup';
import { nowIso } from '../discovery/00-common';

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const venue = await getVenueBySlugOrThrow(client, 'soroswap');
    const entity = await getEntityBySlugOrThrow(client, 'soroswap-native-usdc-pair');

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
      select
        rs.asset_id,
        rs.d_supply_scaled
      from reserve_snapshots rs
      join entities e on e.id = rs.entity_id
      where e.slug = 'soroswap-native-usdc-pair'
      `
    );

    let tvlUsd = 0;

    for (const row of reserveRes.rows as Array<any>) {
      const price = priceMap.get(row.asset_id) ?? 0;
      const reserve = row.d_supply_scaled ? Number(row.d_supply_scaled) : 0;
      tvlUsd += reserve * price;
    }

    const eventsRes = await client.query(
      `
      select count(*)::int as swaps_24h
      from normalized_events ne
      join entities e on e.id = ne.entity_id
      where e.slug = 'soroswap-native-usdc-pair'
        and ne.event_key = 'SoroswapPair:swap'
        and ne.occurred_at >= now() - interval '24 hours'
      `
    );

    const swaps24h = eventsRes.rows[0]?.swaps_24h ?? 0;
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
          source: '69-soroswap-persist-pool-metrics',
          swaps24h,
          note: 'volume_24h_usd and fees_24h_usd still placeholder until swap amounts are fully normalized',
        }),
      ]
    );

    console.log({
      completedAt: asOf,
      entitySlug: entity.slug,
      tvlUsd,
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