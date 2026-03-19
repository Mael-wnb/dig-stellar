import { createPgClient } from '../shared/db';
import { getLatestAssetPricesMap } from '../shared/prices';

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const prices = await getLatestAssetPricesMap(client);

    const reservesRes = await client.query(
      `
      select
        rs.asset_id,
        rs.symbol,
        rs.name,
        rs.d_supply_scaled
      from reserve_snapshots rs
      join entities e on e.id = rs.entity_id
      where e.slug = 'soroswap-native-usdc-pair'
      order by rs.created_at desc
      `
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

    const reserve0 = reserveMetrics[0] ?? null;
    const reserve1 = reserveMetrics[1] ?? null;

    const tvlUsd = reserveMetrics.reduce((sum, r) => sum + (r.reserveUsd ?? 0), 0);

    const eventsRes = await client.query(
      `
      select
        event_key,
        token_amount_in_scaled,
        token_amount_out_scaled,
        occurred_at
      from normalized_events ne
      join entities e on e.id = ne.entity_id
      where e.slug = 'soroswap-native-usdc-pair'
        and ne.occurred_at >= now() - interval '24 hours'
      order by occurred_at desc
      `
    );

    let volume24hUsd = 0;
    let swaps24h = 0;

    for (const row of eventsRes.rows as Array<any>) {
      if (row.event_key !== 'SoroswapPair:swap') continue;

      swaps24h += 1;

      const amountIn = row.token_amount_in_scaled ? Number(row.token_amount_in_scaled) : 0;
      const amountOut = row.token_amount_out_scaled ? Number(row.token_amount_out_scaled) : 0;

      const reserve0Price = reserve0?.priceUsd ?? 0;
      const reserve1Price = reserve1?.priceUsd ?? 0;

      const side0Usd = amountIn * reserve0Price;
      const side1Usd = amountOut * reserve1Price;

      volume24hUsd += Math.max(side0Usd, side1Usd);
    }

    const feeRate = 0.003;
    const fees24hUsd = volume24hUsd * feeRate;

    const output = {
      entitySlug: 'soroswap-native-usdc-pair',
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