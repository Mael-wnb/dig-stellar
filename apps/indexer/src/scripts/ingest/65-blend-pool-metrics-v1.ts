import { createPgClient } from '../shared/db';
import { getLatestAssetPricesMap } from '../shared/prices';

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const prices = await getLatestAssetPricesMap(client);

    const res = await client.query(
      `
      select
        rs.asset_id,
        rs.symbol,
        rs.name,
        rs.d_supply_scaled,
        rs.b_supply_scaled,
        rs.backstop_credit_scaled,
        rs.supply_cap_scaled,
        rs.borrow_apr,
        rs.est_borrow_apy,
        rs.supply_apr,
        rs.est_supply_apy
      from reserve_snapshots rs
      join entities e on e.id = rs.entity_id
      where e.slug = 'blend-fixed-pool'
      order by rs.created_at desc
      `
    );

    const reserveMetrics = (res.rows as Array<any>).map((row) => {
      const priceUsd = prices.get(row.asset_id) ?? null;

      const supplied = row.d_supply_scaled ? Number(row.d_supply_scaled) : null;
      const borrowed = row.b_supply_scaled ? Number(row.b_supply_scaled) : null;
      const backstop = row.backstop_credit_scaled ? Number(row.backstop_credit_scaled) : null;
      const supplyCap = row.supply_cap_scaled ? Number(row.supply_cap_scaled) : null;

      return {
        assetId: row.asset_id,
        symbol: row.symbol,
        name: row.name,
        priceUsd,
        supplied,
        borrowed,
        backstopCredit: backstop,
        supplyCap,
        suppliedUsd: supplied !== null && priceUsd !== null ? supplied * priceUsd : null,
        borrowedUsd: borrowed !== null && priceUsd !== null ? borrowed * priceUsd : null,
        backstopCreditUsd: backstop !== null && priceUsd !== null ? backstop * priceUsd : null,
        supplyCapUsd: supplyCap !== null && priceUsd !== null ? supplyCap * priceUsd : null,
        supplyApr: row.supply_apr !== null ? Number(row.supply_apr) : null,
        supplyApy: row.est_supply_apy !== null ? Number(row.est_supply_apy) : null,
        borrowApr: row.borrow_apr !== null ? Number(row.borrow_apr) : null,
        borrowApy: row.est_borrow_apy !== null ? Number(row.est_borrow_apy) : null,
      };
    });

    const totalSuppliedUsd = reserveMetrics.reduce((sum, r) => sum + (r.suppliedUsd ?? 0), 0);
    const totalBorrowedUsd = reserveMetrics.reduce((sum, r) => sum + (r.borrowedUsd ?? 0), 0);
    const totalBackstopCreditUsd = reserveMetrics.reduce((sum, r) => sum + (r.backstopCreditUsd ?? 0), 0);

    const weightedSupplyApyNumerator = reserveMetrics.reduce(
      (sum, r) => sum + ((r.suppliedUsd ?? 0) * (r.supplyApy ?? 0)),
      0
    );
    const weightedBorrowApyNumerator = reserveMetrics.reduce(
      (sum, r) => sum + ((r.borrowedUsd ?? 0) * (r.borrowApy ?? 0)),
      0
    );

    const output = {
      entitySlug: 'blend-fixed-pool',
      protocol: 'blend',
      type: 'lending_pool',
      totalSuppliedUsd,
      totalBorrowedUsd,
      netLiquidityUsd: totalSuppliedUsd - totalBorrowedUsd,
      totalBackstopCreditUsd,
      weightedSupplyApy: totalSuppliedUsd > 0 ? weightedSupplyApyNumerator / totalSuppliedUsd : null,
      weightedBorrowApy: totalBorrowedUsd > 0 ? weightedBorrowApyNumerator / totalBorrowedUsd : null,
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