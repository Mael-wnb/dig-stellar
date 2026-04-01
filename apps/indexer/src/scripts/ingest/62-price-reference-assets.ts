// apps/indexer/src/scripts/ingest/62-price-reference-assets.ts
import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { inferStablePrice } from '../shared/pricing';

type PriceResolution = {
  price: number;
  source: string;
  metadata: Record<string, unknown>;
};

async function fetchJson(url: string, headers?: Record<string, string>) {
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} on ${url}${text ? `\n${text.slice(0, 500)}` : ''}`);
  }

  return res.json();
}

function getOptionalNumberEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function fetchNativeUsdPrice(): Promise<number> {
  const apiKey = process.env.COINGECKO_API_KEY;
  const headers: Record<string, string> = {};

  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }

  const data = await fetchJson(
    'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
    headers
  );

  const price = data?.stellar?.usd;
  if (typeof price !== 'number') {
    throw new Error('Could not fetch XLM/USD price');
  }

  return price;
}

async function fetchBtcUsdPrice(): Promise<number> {
  const apiKey = process.env.COINGECKO_API_KEY;
  const headers: Record<string, string> = {};

  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }

  const data = await fetchJson(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    headers
  );

  const price = data?.bitcoin?.usd;
  if (typeof price !== 'number') {
    throw new Error('Could not fetch BTC/USD price');
  }

  return price;
}

async function getLatestPriceBySource(
  client: ReturnType<typeof createPgClient>,
  source: string
): Promise<number | null> {
  const res = await client.query(
    `
    select ap.price_usd
    from asset_prices ap
    where ap.source = $1
    order by ap.observed_at desc
    limit 1
    `,
    [source]
  );

  if (!(res.rowCount ?? 0)) return null;

  const value = Number(res.rows[0].price_usd);
  return Number.isFinite(value) ? value : null;
}

async function resolveNativeUsdPrice(
  client: ReturnType<typeof createPgClient>
): Promise<PriceResolution> {
  try {
    const price = await fetchNativeUsdPrice();
    return {
      price,
      source: 'coingecko_xlm_usd',
      metadata: {
        confidence: 'high',
        method: 'direct_native_price',
      },
    };
  } catch (error) {
    const dbFallback = await getLatestPriceBySource(client, 'coingecko_xlm_usd');
    if (dbFallback !== null) {
      return {
        price: dbFallback,
        source: 'db_cached_xlm_usd',
        metadata: {
          confidence: 'medium',
          method: 'latest_db_fallback_after_api_failure',
          fallbackFrom: 'coingecko_xlm_usd',
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }

    const envFallback =
      getOptionalNumberEnv('MANUAL_XLM_USD') ??
      getOptionalNumberEnv('XLM_USD_FALLBACK') ??
      0.165416;

    return {
      price: envFallback,
      source: 'manual_xlm_fallback',
      metadata: {
        confidence: 'medium',
        method: 'manual_fallback_after_api_failure',
        fallbackFrom: 'coingecko_xlm_usd',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function resolveBtcUsdPrice(
  client: ReturnType<typeof createPgClient>
): Promise<PriceResolution> {
  try {
    const price = await fetchBtcUsdPrice();
    return {
      price,
      source: 'coingecko_btc_usd',
      metadata: {
        confidence: 'high',
        method: 'direct_btc_price',
      },
    };
  } catch (error) {
    const dbFallback = await getLatestPriceBySource(client, 'coingecko_btc_usd');
    if (dbFallback !== null) {
      return {
        price: dbFallback,
        source: 'db_cached_btc_usd',
        metadata: {
          confidence: 'medium',
          method: 'latest_db_fallback_after_api_failure',
          fallbackFrom: 'coingecko_btc_usd',
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }

    const envFallback =
      getOptionalNumberEnv('MANUAL_BTC_USD') ??
      getOptionalNumberEnv('BTC_USD_FALLBACK') ??
      69846;

    return {
      price: envFallback,
      source: 'manual_btc_fallback',
      metadata: {
        confidence: 'medium',
        method: 'manual_fallback_after_api_failure',
        fallbackFrom: 'coingecko_btc_usd',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function inferManualPrice(symbol: string): {
  priceUsd: number | null;
  source: string;
  metadata: Record<string, unknown>;
} {
  const s = symbol.toUpperCase();

  if (s === 'USDC' || s === 'PYUSD') {
    return {
      priceUsd: 1,
      source: 'manual_stable',
      metadata: {
        confidence: 'high',
        method: 'hardcoded_stable_assumption',
      },
    };
  }

  if (s === 'EURC') {
    return {
      priceUsd: 1.16,
      source: 'manual_eurc_fallback',
      metadata: {
        confidence: 'medium',
        method: 'temporary_manual_eurc_usd',
        note: 'Replace later with FX-backed EUR/USD source',
      },
    };
  }

  const stable = inferStablePrice(s);
  if (stable !== null) {
    return {
      priceUsd: stable,
      source: 'manual_stable',
      metadata: {
        confidence: 'high',
        method: 'hardcoded_stable_assumption',
      },
    };
  }

  return {
    priceUsd: null,
    source: 'unknown',
    metadata: {},
  };
}

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const observedAt = nowIso();

    const assetsRes = await client.query(
      `
      select id, contract_address, symbol, name
      from assets
      where chain = 'stellar-mainnet'
      order by symbol asc nulls last
      `
    );

    const nativeResolved = await resolveNativeUsdPrice(client);
    const btcResolved = await resolveBtcUsdPrice(client);

    let inserted = 0;

    for (const asset of assetsRes.rows as Array<{
      id: string;
      contract_address: string;
      symbol: string | null;
      name: string | null;
    }>) {
      const symbol = asset.symbol ?? '';
      const symbolUpper = symbol.toUpperCase();

      let priceUsd: number | null = null;
      let source = 'manual';
      let metadata: Record<string, unknown> = {};

      if (symbol.toLowerCase() === 'native') {
        priceUsd = nativeResolved.price;
        source = nativeResolved.source;
        metadata = nativeResolved.metadata;
      } else if (symbolUpper === 'SOLVBTC' || symbolUpper === 'XSOLVBTC') {
        priceUsd = btcResolved.price;
        source = 'coingecko_btc_proxy';
        metadata = {
          confidence: 'medium',
          method: 'btc_proxy_price',
          proxy: 'BTC',
          upstreamSource: btcResolved.source,
          upstreamMetadata: btcResolved.metadata,
          note: 'Temporary assumption: wrapped / derivative BTC assets priced at BTC spot',
        };
      } else {
        const manual = inferManualPrice(symbol);
        priceUsd = manual.priceUsd;
        source = manual.source;
        metadata = manual.metadata;
      }

      if (priceUsd === null) continue;

      await client.query(
        `
        insert into asset_prices (asset_id, price_usd, source, observed_at, metadata)
        values ($1, $2, $3, $4, $5::jsonb)
        on conflict (asset_id, source, observed_at) do nothing
        `,
        [asset.id, priceUsd, source, observedAt, JSON.stringify(metadata)]
      );

      inserted += 1;
      console.log(symbol || asset.contract_address, '=>', priceUsd, source);
    }

    console.log({
      completedAt: observedAt,
      inserted,
      nativeUsd: nativeResolved.price,
      nativeSource: nativeResolved.source,
      btcUsd: btcResolved.price,
      btcSource: btcResolved.source,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});