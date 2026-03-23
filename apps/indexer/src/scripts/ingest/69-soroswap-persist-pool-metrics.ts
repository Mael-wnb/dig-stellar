import { loadJson, nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { getEntityBySlugOrThrow, getVenueBySlugOrThrow } from '../shared/lookup';

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function resolveEntitySlug(): Promise<string> {
  const fromEnv = process.env.ENTITY_SLUG?.trim();
  if (fromEnv) return fromEnv;

  const registry = await loadJson<any>('59-soroswap-final-registry.json');
  const fromRegistry = registry?.pair?.entitySlug;

  if (typeof fromRegistry === 'string' && fromRegistry.length > 0) {
    return fromRegistry;
  }

  throw new Error(
    'Missing ENTITY_SLUG. Set ENTITY_SLUG in env or generate 59-soroswap-final-registry.json first.'
  );
}

async function main() {
  const entitySlug = await resolveEntitySlug();

  const client = createPgClient();
  await client.connect();

  try {
    const venue = await getVenueBySlugOrThrow(client, 'soroswap');
    const entity = await getEntityBySlugOrThrow(client, entitySlug);

    const pricesRes = await client.query(
      `
      select distinct on (ap.asset_id)
        ap.asset_id,
        ap.price_usd
      from asset_prices ap
      order by ap.asset_id, ap.observed_at desc
      `
    );

    const priceMap = new Map<string, number>(
      pricesRes.rows.map((row: { asset_id: string; price_usd: string | number }) => [
        row.asset_id,
        Number(row.price_usd),
      ])
    );

    const reserveRes = await client.query(
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

    let tvlUsd = 0;
    const reserveBreakdown: Array<{
      assetId: string;
      symbol: string | null;
      name: string | null;
      reserve: number;
      priceUsd: number | null;
      reserveUsd: number | null;
    }> = [];

    for (const row of reserveRes.rows as Array<{
      asset_id: string;
      symbol: string | null;
      name: string | null;
      d_supply_scaled: string | number | null;
    }>) {
      const reserve = toNumber(row.d_supply_scaled);
      const priceUsd = priceMap.has(row.asset_id) ? priceMap.get(row.asset_id)! : null;
      const reserveUsd = priceUsd !== null ? reserve * priceUsd : null;

      if (reserveUsd !== null) {
        tvlUsd += reserveUsd;
      }

      reserveBreakdown.push({
        assetId: row.asset_id,
        symbol: row.symbol,
        name: row.name,
        reserve,
        priceUsd,
        reserveUsd,
      });
    }

    const eventsRes = await client.query(
      `
      select
        ne.event_key,
        ne.token_in_asset_id,
        ne.token_out_asset_id,
        ne.token_amount_in_scaled,
        ne.token_amount_out_scaled
      from normalized_events ne
      join entities e on e.id = ne.entity_id
      where e.slug = $1
        and ne.occurred_at >= now() - interval '24 hours'
      `,
      [entitySlug]
    );

    let swaps24h = 0;
    let volume24hUsd = 0;

    for (const row of eventsRes.rows as Array<{
      event_key: string | null;
      token_in_asset_id: string | null;
      token_out_asset_id: string | null;
      token_amount_in_scaled: string | number | null;
      token_amount_out_scaled: string | number | null;
    }>) {
      if (row.event_key !== 'SoroswapPair:swap') continue;

      swaps24h += 1;

      const tokenInPrice =
        row.token_in_asset_id && priceMap.has(row.token_in_asset_id)
          ? priceMap.get(row.token_in_asset_id) ?? 0
          : 0;

      const tokenOutPrice =
        row.token_out_asset_id && priceMap.has(row.token_out_asset_id)
          ? priceMap.get(row.token_out_asset_id) ?? 0
          : 0;

      const amountIn = toNumber(row.token_amount_in_scaled);
      const amountOut = toNumber(row.token_amount_out_scaled);

      const amountInUsd = amountIn * tokenInPrice;
      const amountOutUsd = amountOut * tokenOutPrice;

      volume24hUsd += Math.max(amountInUsd, amountOutUsd);
    }

    const fees24hUsd = volume24hUsd * 0.003;
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
        volume24hUsd,
        fees24hUsd,
        null,
        null,
        null,
        null,
        null,
        null,
        JSON.stringify({
          source: '69-soroswap-persist-pool-metrics',
          entitySlug,
          swaps24h,
          reserveBreakdown,
        }),
      ]
    );

    console.log({
      completedAt: asOf,
      entitySlug: entity.slug,
      tvlUsd,
      volume24hUsd,
      fees24hUsd,
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