import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { safeDivide } from '../shared/pricing';

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const observedAt = nowIso();

    const pairRes = await client.query(
      `
      select
        e.id as entity_id,
        e.slug as entity_slug
      from entities e
      where e.slug = 'soroswap-native-usdc-pair'
      limit 1
      `
    );

if (!(pairRes.rowCount ?? 0)) {
  throw new Error('Missing soroswap-native-usdc-pair entity');
}

    const snapshotRes = await client.query(
      `
      select
        rs.asset_id,
        rs.symbol,
        rs.d_supply_scaled
      from reserve_snapshots rs
      join entities e on e.id = rs.entity_id
      where e.slug = 'soroswap-native-usdc-pair'
      order by rs.created_at desc
      limit 2
      `
    );

    if ((snapshotRes.rowCount ?? 0) < 2) {
        throw new Error('Missing reserve snapshots for soroswap-native-usdc-pair');
      }

    const reserves = snapshotRes.rows as Array<{
      asset_id: string;
      symbol: string;
      d_supply_scaled: string | null;
    }>;

    const latestPricesRes = await client.query(
      `
      select distinct on (ap.asset_id)
        ap.asset_id,
        ap.price_usd,
        ap.source,
        ap.observed_at
      from asset_prices ap
      order by ap.asset_id, ap.observed_at desc
      `
    );

    const latestPriceByAsset = new Map<string, number>();
    for (const row of latestPricesRes.rows as Array<{ asset_id: string; price_usd: string }>) {
      latestPriceByAsset.set(row.asset_id, Number(row.price_usd));
    }

    const r0 = reserves[0];
    const r1 = reserves[1];

    const reserve0 = Number(r0.d_supply_scaled ?? 0);
    const reserve1 = Number(r1.d_supply_scaled ?? 0);

    const price0 = latestPriceByAsset.get(r0.asset_id) ?? null;
    const price1 = latestPriceByAsset.get(r1.asset_id) ?? null;

    let inserted = 0;

    if (price0 !== null && price1 === null) {
      const derived = safeDivide(reserve0 * price0, reserve1);
      if (derived !== null) {
        await client.query(
          `
          insert into asset_prices (asset_id, price_usd, source, observed_at, metadata)
          values ($1, $2, $3, $4, $5::jsonb)
          on conflict (asset_id, source, observed_at) do nothing
          `,
          [
            r1.asset_id,
            derived,
            'soroswap_derived_pair',
            observedAt,
            JSON.stringify({
              pair: 'soroswap-native-usdc-pair',
              baseSymbol: r0.symbol,
              quoteSymbol: r1.symbol,
              method: 'derived_from_pair_reserves',
            }),
          ]
        );
        inserted += 1;
        console.log(r1.symbol, '=>', derived, 'derived from', r0.symbol);
      }
    }

    if (price1 !== null && price0 === null) {
      const derived = safeDivide(reserve1 * price1, reserve0);
      if (derived !== null) {
        await client.query(
          `
          insert into asset_prices (asset_id, price_usd, source, observed_at, metadata)
          values ($1, $2, $3, $4, $5::jsonb)
          on conflict (asset_id, source, observed_at) do nothing
          `,
          [
            r0.asset_id,
            derived,
            'soroswap_derived_pair',
            observedAt,
            JSON.stringify({
              pair: 'soroswap-native-usdc-pair',
              baseSymbol: r1.symbol,
              quoteSymbol: r0.symbol,
              method: 'derived_from_pair_reserves',
            }),
          ]
        );
        inserted += 1;
        console.log(r0.symbol, '=>', derived, 'derived from', r1.symbol);
      }
    }

    console.log({
      completedAt: observedAt,
      inserted,
      reserve0: { symbol: r0.symbol, amount: reserve0, price: price0 },
      reserve1: { symbol: r1.symbol, amount: reserve1, price: price1 },
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});