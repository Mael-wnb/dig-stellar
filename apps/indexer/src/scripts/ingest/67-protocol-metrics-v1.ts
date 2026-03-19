import { createPgClient } from '../shared/db';
import { getLatestAssetPricesMap } from '../shared/prices';

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const prices = await getLatestAssetPricesMap(client);

    const blendRes = await client.query(
      `
      select
        rs.asset_id,
        rs.d_supply_scaled,
        rs.b_supply_scaled,
        rs.est_supply_apy,
        rs.est_borrow_apy
      from reserve_snapshots rs
      join entities e on e.id = rs.entity_id
      where e.slug = 'blend-fixed-pool'
      `
    );

    let blendTvlUsd = 0;
    let blendSupplyWeighted = 0;
    let blendBorrowWeighted = 0;
    let blendSupplyBase = 0;
    let blendBorrowBase = 0;

    for (const row of blendRes.rows as Array<any>) {
      const price = prices.get(row.asset_id) ?? 0;
      const supplied = row.d_supply_scaled ? Number(row.d_supply_scaled) : 0;
      const borrowed = row.b_supply_scaled ? Number(row.b_supply_scaled) : 0;
      const suppliedUsd = supplied * price;
      const borrowedUsd = borrowed * price;

      blendTvlUsd += suppliedUsd;
      blendSupplyWeighted += suppliedUsd * (row.est_supply_apy ? Number(row.est_supply_apy) : 0);
      blendBorrowWeighted += borrowedUsd * (row.est_borrow_apy ? Number(row.est_borrow_apy) : 0);
      blendSupplyBase += suppliedUsd;
      blendBorrowBase += borrowedUsd;
    }

    const soroswapRes = await client.query(
      `
      select
        rs.asset_id,
        rs.d_supply_scaled
      from reserve_snapshots rs
      join entities e on e.id = rs.entity_id
      where e.slug = 'soroswap-native-usdc-pair'
      `
    );

    let soroswapTvlUsd = 0;

    for (const row of soroswapRes.rows as Array<any>) {
      const price = prices.get(row.asset_id) ?? 0;
      const reserve = row.d_supply_scaled ? Number(row.d_supply_scaled) : 0;
      soroswapTvlUsd += reserve * price;
    }

    const output = [
      {
        protocol: 'blend',
        type: 'lending',
        tvlUsd: blendTvlUsd,
        avgSupplyApy: blendSupplyBase > 0 ? blendSupplyWeighted / blendSupplyBase : null,
        avgBorrowApy: blendBorrowBase > 0 ? blendBorrowWeighted / blendBorrowBase : null,
      },
      {
        protocol: 'soroswap',
        type: 'amm',
        tvlUsd: soroswapTvlUsd,
        avgSupplyApy: null,
        avgBorrowApy: null,
      },
    ];

    console.table(output);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});