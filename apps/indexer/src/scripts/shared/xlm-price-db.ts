// apps/indexer/src/scripts/shared/xlm-price-db.ts
//
// DB reads for the price selection (xlm-price.ts). Everything here is already
// written by the refresh pipeline in the previous cycle — no new fetch, no schema:
//   - Soroswap pairs (constant-product by design) + Aquarius pools whose registry
//     type is EXPLICITLY 'constant_product' → reserve_snapshots (symbol,
//     d_supply_scaled). Aquarius 'stable' (StableSwap), 'concentrated' and unknown
//     types are excluded: their reserve ratio is not a spot price;
//   - SDEX liquidity pools → pool_snapshots.metadata.reserves (Horizon shape
//     [{asset:'native'|'CODE:ISSUER', amount}]).
// The reserve sets are loaded ONCE per run (loadPoolReserveSets) and every asset
// derives its candidates from them in memory (candidatesFromPools, pure).
import type { Client } from 'pg';
import { getOptionalNumberEnv } from './env';
import {
  candidatesFromPools,
  compute24hChangePct,
  selectPrice,
  type PoolReserveSet,
  type PricePoint,
  type XlmPriceSelection,
  type XlmReference,
} from './xlm-price';

const COINGECKO_SOURCES = ['coingecko_direct', 'coingecko_xlm_usd'];

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function loadPoolReserveSets(client: Client): Promise<PoolReserveSet[]> {
  const sets = new Map<string, PoolReserveSet>();

  // AMM pools (Aquarius constant-product + every Soroswap pair): latest reserve per leg.
  const amm = await client.query(
    `
    with latest as (
      select distinct on (rs.entity_id, rs.asset_id)
        rs.entity_id, rs.symbol, rs.d_supply_scaled, rs.snapshot_at
      from reserve_snapshots rs
      order by rs.entity_id, rs.asset_id, rs.snapshot_at desc, rs.created_at desc
    )
    select e.slug, v.slug as venue, l.symbol, l.d_supply_scaled, l.snapshot_at
    from latest l
    join entities e on e.id = l.entity_id
    join venues v on v.id = e.venue_id
    where e.is_active
      and (
        -- Soroswap pairs are constant-product by design.
        v.slug = 'soroswap'
        -- Aquarius: ONLY an explicit constant_product type (registry metadata copied into
        -- entities.metadata by seed-core). 'stable' (StableSwap: the reserve ratio is not a
        -- price — e.g. USDGLO/USDC at 0.899 for a $1 stablecoin), 'concentrated' and an
        -- unknown type are all EXCLUDED.
        or (v.slug = 'aquarius' and e.metadata->'info'->>'pool_type' = 'constant_product')
      )
      and e.slug not like '%-clpool'
    `
  );
  for (const row of amm.rows as Array<{ slug: string; venue: 'aquarius' | 'soroswap'; symbol: string | null; d_supply_scaled: unknown; snapshot_at: Date }>) {
    const amount = num(row.d_supply_scaled);
    if (!row.symbol || amount === null) continue;
    const at = new Date(row.snapshot_at);
    const set = sets.get(row.slug) ?? { pool: row.slug, venue: row.venue, observedAt: at, reserves: [] };
    // both legs share snapshot_at; keep the older one to be safe
    if (at.getTime() < set.observedAt.getTime()) set.observedAt = at;
    set.reserves.push({ symbol: row.symbol, amount });
    sets.set(row.slug, set);
  }

  // SDEX liquidity pools: latest pool_snapshots row per entity, reserves in metadata.
  const sdex = await client.query(
    `
    select distinct on (ps.entity_id) e.slug, ps.snapshot_at, ps.metadata
    from pool_snapshots ps
    join entities e on e.id = ps.entity_id
    join venues v on v.id = e.venue_id
    where v.slug = 'stellar-native' and e.is_active
    order by ps.entity_id, ps.snapshot_at desc
    `
  );
  for (const row of sdex.rows as Array<{ slug: string; snapshot_at: Date; metadata: { reserves?: Array<{ asset?: string; amount?: string }> } }>) {
    const reserves = Array.isArray(row.metadata?.reserves) ? row.metadata.reserves : [];
    const legs = reserves
      .map((r) => ({ symbol: r.asset === 'native' ? 'native' : String(r.asset ?? '').split(':')[0], amount: num(r.amount) }))
      .filter((l): l is { symbol: string; amount: number } => l.symbol !== '' && l.amount !== null);
    if (legs.length !== 2) continue;
    sets.set(row.slug, { pool: row.slug, venue: 'sdex', observedAt: new Date(row.snapshot_at), reserves: legs });
  }

  return [...sets.values()];
}

export async function loadAssetId(client: Client, symbol: string): Promise<string | null> {
  const res = await client.query(
    `select id from assets where chain = 'stellar-mainnet' and symbol = $1 limit 1`,
    [symbol]
  );
  return res.rowCount ? String(res.rows[0].id) : null;
}

export async function loadCoinGeckoReference(client: Client, assetId: string): Promise<XlmReference | null> {
  const res = await client.query(
    `
    select price_usd, observed_at
    from asset_prices
    where asset_id = $1 and source = any($2::text[])
    order by observed_at desc
    limit 1
    `,
    [assetId, COINGECKO_SOURCES]
  );
  if (!res.rowCount) return null;
  const priceUsd = num(res.rows[0].price_usd);
  return priceUsd === null ? null : { priceUsd, observedAt: new Date(res.rows[0].observed_at) };
}

export type ResolveAssetArgs = {
  symbol: string;
  /** CoinGecko price when it was called and answered for this asset, else null */
  coingecko: number | null;
  /** MANUAL_<ASSET>_USD-style env var(s) honoured as an explicit override */
  manualEnvVars: string[];
  /** XLM/USD resolved earlier in the run (enables two-hop candidates); null for XLM itself */
  xlmUsd: number | null;
  sets: PoolReserveSet[];
  now: Date;
};

// The one entry point step 1 uses for every asset (XLM included, with xlmUsd null).
export async function resolveAssetPrice(client: Client, args: ResolveAssetArgs): Promise<XlmPriceSelection> {
  const assetId = await loadAssetId(client, args.symbol);
  const reference = assetId ? await loadCoinGeckoReference(client, assetId) : null;
  let manualOverride: number | null = null;
  for (const name of args.manualEnvVars) {
    manualOverride = getOptionalNumberEnv(name);
    if (manualOverride !== null) break;
  }
  return selectPrice({
    asset: args.symbol,
    now: args.now,
    manualOverride,
    manualEnvVar: args.manualEnvVars.join('|'),
    coingecko: args.coingecko,
    reference,
    onchain: candidatesFromPools(args.symbol, args.sets, args.xlmUsd),
  });
}

/** XLM entry point kept for the hotfix call sites. */
export async function resolveXlmPrice(client: Client, coingecko: number | null, now: Date, sets?: PoolReserveSet[]): Promise<XlmPriceSelection> {
  return resolveAssetPrice(client, {
    symbol: 'native',
    coingecko,
    manualEnvVars: ['MANUAL_XLM_USD', 'XLM_USD_FALLBACK'],
    xlmUsd: null,
    sets: sets ?? (await loadPoolReserveSets(client)),
    now,
  });
}

// Latest native row (any source) written within `maxAgeMs` — step 9 reads the row
// step 1 wrote in the same run instead of calling CoinGecko a second time.
export async function loadLatestNativePrice(
  client: Client,
  maxAgeMs: number,
  now: Date
): Promise<PricePoint | null> {
  const res = await client.query(
    `
    select ap.price_usd, ap.observed_at, ap.source
    from asset_prices ap
    join assets a on a.id = ap.asset_id
    where a.chain = 'stellar-mainnet' and a.symbol = 'native'
      and ap.observed_at >= $1::timestamptz
    order by ap.observed_at desc
    limit 1
    `,
    [new Date(now.getTime() - maxAgeMs).toISOString()]
  );
  if (!res.rowCount) return null;
  const priceUsd = num(res.rows[0].price_usd);
  return priceUsd === null
    ? null
    : { priceUsd, observedAt: new Date(res.rows[0].observed_at), source: String(res.rows[0].source) };
}

export async function loadNative24hChange(
  client: Client,
  latest: PricePoint | null,
  now: Date
): Promise<{ changePct: number | null; basis: PricePoint | null }> {
  if (!latest) return { changePct: null, basis: null };
  const res = await client.query(
    `
    select ap.price_usd, ap.observed_at, ap.source
    from asset_prices ap
    join assets a on a.id = ap.asset_id
    where a.chain = 'stellar-mainnet' and a.symbol = 'native'
      and ap.observed_at between $1::timestamptz and $2::timestamptz
    `,
    [
      new Date(now.getTime() - 25 * 3_600_000).toISOString(),
      new Date(now.getTime() - 23 * 3_600_000).toISOString(),
    ]
  );
  const history: PricePoint[] = (res.rows as Array<{ price_usd: unknown; observed_at: Date; source: string }>)
    .map((r) => ({ priceUsd: num(r.price_usd) ?? 0, observedAt: new Date(r.observed_at), source: r.source }));
  return compute24hChangePct(latest, history, now);
}
