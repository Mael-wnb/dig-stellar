import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { safeDivide } from '../shared/pricing';

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getTargetEntitySlug(): string {
  return process.env.ENTITY_SLUG?.trim() || 'soroswap-native-usdc-pair';
}

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const observedAt = nowIso();
    const entitySlug = getTargetEntitySlug();

    const pairRes = await client.query(
      `
      select
        e.id as entity_id,
        e.slug as entity_slug
      from entities e
      where e.slug = $1
      limit 1
      `,
      [entitySlug]
    );

    if (!(pairRes.rowCount ?? 0)) {
      throw new Error(`Missing entity: ${entitySlug}`);
    }

    const snapshotRes = await client.query(
      `
      select distinct on (rs.asset_id)
        rs.asset_id,
        rs.symbol,
        rs.d_supply_scaled,
        rs.snapshot_at
      from reserve_snapshots rs
      join entities e on e.id = rs.entity_id
      where e.slug = $1
      order by rs.asset_id, rs.snapshot_at desc, rs.created_at desc
      `,
      [entitySlug]
    );

    if ((snapshotRes.rowCount ?? 0) < 2) {
      throw new Error(`Missing reserve snapshots for ${entitySlug}`);
    }

    const reserves = snapshotRes.rows as Array<{
      asset_id: string;
      symbol: string | null;
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
    for (const row of latestPricesRes.rows as Array<{ asset_id: string; price_usd: string | number }>) {
      latestPriceByAsset.set(row.asset_id, Number(row.price_usd));
    }

    const r0 = reserves[0];
    const r1 = reserves[1];

    const reserve0 = toNumber(r0.d_supply_scaled);
    const reserve1 = toNumber(r1.d_supply_scaled);

    const price0 = latestPriceByAsset.get(r0.asset_id) ?? null;
    const price1 = latestPriceByAsset.get(r1.asset_id) ?? null;

    let inserted = 0;

    if (reserve0 !== null && reserve1 !== null && price0 !== null && price1 === null) {
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
              pair: entitySlug,
              baseSymbol: r0.symbol,
              quoteSymbol: r1.symbol,
              method: 'derived_from_pair_reserves',
            }),
          ]
        );

        inserted += 1;
        console.log(r1.symbol, '=>', derived, 'derived from', r0.symbol, 'via', entitySlug);
      }
    }

    if (reserve0 !== null && reserve1 !== null && price1 !== null && price0 === null) {
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
              pair: entitySlug,
              baseSymbol: r1.symbol,
              quoteSymbol: r0.symbol,
              method: 'derived_from_pair_reserves',
            }),
          ]
        );

        inserted += 1;
        console.log(r0.symbol, '=>', derived, 'derived from', r1.symbol, 'via', entitySlug);
      }
    }

    console.log({
      completedAt: observedAt,
      entitySlug,
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