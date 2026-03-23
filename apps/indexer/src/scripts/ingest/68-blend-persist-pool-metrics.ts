import { createPgClient } from '../shared/db';
import { getVenueBySlugOrThrow, getEntityBySlugOrThrow } from '../shared/lookup';
import { nowIso } from '../discovery/00-common';

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const venue = await getVenueBySlugOrThrow(client, 'blend');
    const entity = await getEntityBySlugOrThrow(client, 'blend-fixed-pool');

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
        rs.d_supply_scaled,
        rs.b_supply_scaled,
        rs.backstop_credit_scaled,
        rs.est_supply_apy,
        rs.est_borrow_apy
      from reserve_snapshots rs
      join entities e on e.id = rs.entity_id
      where e.slug = 'blend-fixed-pool'
      `
    );

    let totalSuppliedUsd = 0;
    let totalBorrowedUsd = 0;
    let totalBackstopCreditUsd = 0;
    let weightedSupplyApyNumerator = 0;
    let weightedBorrowApyNumerator = 0;

    for (const row of reserveRes.rows as Array<any>) {
      const price = priceMap.get(row.asset_id) ?? 0;
      const supplied = row.d_supply_scaled ? Number(row.d_supply_scaled) : 0;
      const borrowed = row.b_supply_scaled ? Number(row.b_supply_scaled) : 0;
      const backstop = row.backstop_credit_scaled ? Number(row.backstop_credit_scaled) : 0;
      const supplyApy = row.est_supply_apy ? Number(row.est_supply_apy) : 0;
      const borrowApy = row.est_borrow_apy ? Number(row.est_borrow_apy) : 0;

      const suppliedUsd = supplied * price;
      const borrowedUsd = borrowed * price;
      const backstopUsd = backstop * price;

      totalSuppliedUsd += suppliedUsd;
      totalBorrowedUsd += borrowedUsd;
      totalBackstopCreditUsd += backstopUsd;

      weightedSupplyApyNumerator += suppliedUsd * supplyApy;
      weightedBorrowApyNumerator += borrowedUsd * borrowApy;
    }

    const weightedSupplyApy =
      totalSuppliedUsd > 0 ? weightedSupplyApyNumerator / totalSuppliedUsd : null;

    const weightedBorrowApy =
      totalBorrowedUsd > 0 ? weightedBorrowApyNumerator / totalBorrowedUsd : null;

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
        totalSuppliedUsd,
        null,
        null,
        totalSuppliedUsd,
        totalBorrowedUsd,
        totalSuppliedUsd - totalBorrowedUsd,
        totalBackstopCreditUsd,
        weightedSupplyApy,
        weightedBorrowApy,
        JSON.stringify({
          source: '68-blend-persist-pool-metrics',
          note: 'For lending pools, tvl_usd currently mirrors total_supplied_usd',
        }),
      ]
    );

    console.log({
      completedAt: asOf,
      entitySlug: entity.slug,
      totalSuppliedUsd,
      totalBorrowedUsd,
      weightedSupplyApy,
      weightedBorrowApy,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});