import { loadJson } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { getLatestAssetPricesMap } from '../shared/prices';

async function main() {
  const registry = await loadJson<any>('59-soroswap-final-registry.json');
  if (!registry) {
    throw new Error('Missing 59-soroswap-final-registry.json');
  }

  const entitySlug = registry.pair?.entitySlug;
  if (!entitySlug) {
    throw new Error('Missing entitySlug in 59-soroswap-final-registry.json');
  }

  const client = createPgClient();
  await client.connect();

  try {
    const prices = await getLatestAssetPricesMap(client);

    const reservesRes = await client.query(
      `
      select distinct on (rs.asset_id)
        rs.asset_id,
        rs.symbol,
        rs.name,
        rs.d_supply_scaled,
        rs.snapshot_at
      from reserve_snapshots rs
      join entities e on e.id = rs.entity_id
      where e.slug = $1
      order by rs.asset_id, rs.snapshot_at desc, rs.created_at desc
      `,
      [entitySlug]
    );

    const reserveMetrics = (reservesRes.rows as Array<any>).map((row) => {
      const reserve = row.d_supply_scaled ? Number(row.d_supply_scaled) : null;
      const priceUsd = prices.get(row.asset_id) ?? null;

      return {
        assetId: row.asset_id,
        symbol: row.symbol,
        name: row.name,
        reserve,
        priceUsd,
        reserveUsd: reserve !== null && priceUsd !== null ? reserve * priceUsd : null,
      };
    });

    const tvlUsd = reserveMetrics.reduce((sum, r) => sum + (r.reserveUsd ?? 0), 0);

    const eventsRes = await client.query(
      `
      select
        ne.event_key,
        ne.token_in_asset_id,
        ne.token_out_asset_id,
        ne.token_amount_in_scaled,
        ne.token_amount_out_scaled,
        ne.occurred_at
      from normalized_events ne
      join entities e on e.id = ne.entity_id
      where e.slug = $1
        and ne.occurred_at >= now() - interval '24 hours'
      order by ne.occurred_at desc
      `,
      [entitySlug]
    );

    let volume24hUsd = 0;
    let swaps24h = 0;

    for (const row of eventsRes.rows as Array<any>) {
      if (row.event_key !== 'SoroswapPair:swap') continue;

      swaps24h += 1;

      const tokenInPrice =
        row.token_in_asset_id && prices.has(row.token_in_asset_id)
          ? prices.get(row.token_in_asset_id) ?? 0
          : 0;

      const tokenOutPrice =
        row.token_out_asset_id && prices.has(row.token_out_asset_id)
          ? prices.get(row.token_out_asset_id) ?? 0
          : 0;

      const amountIn = row.token_amount_in_scaled ? Number(row.token_amount_in_scaled) : 0;
      const amountOut = row.token_amount_out_scaled ? Number(row.token_amount_out_scaled) : 0;

      const amountInUsd = amountIn * tokenInPrice;
      const amountOutUsd = amountOut * tokenOutPrice;

      volume24hUsd += Math.max(amountInUsd, amountOutUsd);
    }

    const feeRate = 0.003;
    const fees24hUsd = volume24hUsd * feeRate;

    const output = {
      entitySlug,
      protocol: 'soroswap',
      type: 'amm_pool',
      tvlUsd,
      volume24hUsd,
      fees24hUsd,
      swaps24h,
      reserves: reserveMetrics,
    };

    console.dir(output, { depth: 8 });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});