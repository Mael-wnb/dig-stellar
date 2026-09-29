// apps/indexer/src/scripts/shared/xlm-price-db.ts
//
// DB reads for the XLM/USD selection (xlm-price.ts). Everything here is already
// written by the refresh pipeline in the previous cycle — no new fetch, no schema:
//   - Soroswap + Aquarius XLM/USDC constant-product pools → reserve_snapshots
//     (symbol 'native' / 'USDC', d_supply_scaled);
//   - SDEX XLM/USDC liquidity pool → pool_snapshots.metadata.reserves (Horizon shape
//     [{asset:'native'|'USDC:G…', amount}]).
// The Aquarius concentrated pool is deliberately excluded: its reserves ratio is
// not a spot price.
import type { Client } from 'pg';
import { getOptionalNumberEnv } from './env';
import {
  compute24hChangePct,
  selectXlmPrice,
  type PricePoint,
  type XlmOnchainCandidate,
  type XlmPriceSelection,
  type XlmReference,
} from './xlm-price';

const AMM_XLM_USDC_POOLS: ReadonlyArray<{ slug: string; source: string }> = [
  { slug: 'aquarius-native-usdc-pool', source: 'onchain_aquarius_xlm_usdc' },
  { slug: 'soroswap-native-usdc-pair', source: 'onchain_soroswap_xlm_usdc' },
];
const SDEX_XLM_USDC_POOL = { slug: 'stellar-native-native-usdc-pool', source: 'onchain_sdex_xlm_usdc' };
const COINGECKO_NATIVE_SOURCES = ['coingecko_direct', 'coingecko_xlm_usd'];

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function loadOnchainXlmCandidates(client: Client): Promise<XlmOnchainCandidate[]> {
  const out: XlmOnchainCandidate[] = [];

  for (const pool of AMM_XLM_USDC_POOLS) {
    const res = await client.query(
      `
      select distinct on (rs.asset_id) rs.symbol, rs.d_supply_scaled, rs.snapshot_at
      from reserve_snapshots rs
      join entities e on e.id = rs.entity_id
      where e.slug = $1
      order by rs.asset_id, rs.snapshot_at desc, rs.created_at desc
      `,
      [pool.slug]
    );
    const rows = res.rows as Array<{ symbol: string | null; d_supply_scaled: unknown; snapshot_at: Date }>;
    const xlm = rows.find((r) => r.symbol === 'native');
    const usdc = rows.find((r) => r.symbol === 'USDC');
    const xlmReserve = num(xlm?.d_supply_scaled);
    const usdcReserve = num(usdc?.d_supply_scaled);
    if (xlm && usdc && xlmReserve !== null && usdcReserve !== null) {
      // Both legs of one snapshot share snapshot_at; take the older one to be safe.
      const observedAt = new Date(Math.min(new Date(xlm.snapshot_at).getTime(), new Date(usdc.snapshot_at).getTime()));
      out.push({ source: pool.source, pool: pool.slug, xlmReserve, usdcReserve, observedAt });
    }
  }

  const sdexRes = await client.query(
    `
    select ps.snapshot_at, ps.metadata
    from pool_snapshots ps
    join entities e on e.id = ps.entity_id
    where e.slug = $1
    order by ps.snapshot_at desc
    limit 1
    `,
    [SDEX_XLM_USDC_POOL.slug]
  );
  if (sdexRes.rowCount) {
    const row = sdexRes.rows[0] as { snapshot_at: Date; metadata: { reserves?: Array<{ asset?: string; amount?: string }> } };
    const reserves = Array.isArray(row.metadata?.reserves) ? row.metadata.reserves : [];
    const xlmReserve = num(reserves.find((r) => r.asset === 'native')?.amount);
    const usdcReserve = num(reserves.find((r) => typeof r.asset === 'string' && r.asset.startsWith('USDC:'))?.amount);
    if (xlmReserve !== null && usdcReserve !== null) {
      out.push({
        source: SDEX_XLM_USDC_POOL.source,
        pool: SDEX_XLM_USDC_POOL.slug,
        xlmReserve,
        usdcReserve,
        observedAt: new Date(row.snapshot_at),
      });
    }
  }

  return out;
}

export async function loadNativeAssetId(client: Client): Promise<string | null> {
  const res = await client.query(
    `select id from assets where chain = 'stellar-mainnet' and symbol = 'native' limit 1`
  );
  return res.rowCount ? String(res.rows[0].id) : null;
}

export async function loadCoinGeckoReference(client: Client, nativeAssetId: string): Promise<XlmReference | null> {
  const res = await client.query(
    `
    select price_usd, observed_at
    from asset_prices
    where asset_id = $1 and source = any($2::text[])
    order by observed_at desc
    limit 1
    `,
    [nativeAssetId, COINGECKO_NATIVE_SOURCES]
  );
  if (!res.rowCount) return null;
  const priceUsd = num(res.rows[0].price_usd);
  return priceUsd === null ? null : { priceUsd, observedAt: new Date(res.rows[0].observed_at) };
}

// The one entry point both steps use. `coingecko` is the price step 1 obtained
// (or null when the call failed); the manual override comes from the env.
export async function resolveXlmPrice(client: Client, coingecko: number | null, now: Date): Promise<XlmPriceSelection> {
  const nativeAssetId = await loadNativeAssetId(client);
  const [reference, onchain] = await Promise.all([
    nativeAssetId ? loadCoinGeckoReference(client, nativeAssetId) : Promise.resolve(null),
    loadOnchainXlmCandidates(client),
  ]);
  const manualOverride = getOptionalNumberEnv('MANUAL_XLM_USD') ?? getOptionalNumberEnv('XLM_USD_FALLBACK');
  return selectXlmPrice({ now, manualOverride, coingecko, reference, onchain });
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
