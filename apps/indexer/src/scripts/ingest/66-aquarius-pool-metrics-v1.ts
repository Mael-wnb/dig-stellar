import { loadJson } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { getLatestAssetPricesMap } from '../shared/prices';

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
      order by rs.asset_id, rs.snapshot_at desc
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

    const output = {
      entitySlug,
      protocol: 'aquarius',
      type: 'amm_pool',
      tvlUsd,
      volume24hUsd: 0,
      fees24hUsd: 0,
      swaps24h: 0,
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