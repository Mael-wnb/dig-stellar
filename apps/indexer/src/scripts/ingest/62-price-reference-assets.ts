// apps/indexer/src/scripts/ingest/62-price-reference-assets.ts
import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { inferStablePrice } from '../shared/pricing';
import { PRICING_RULES_BY_SYMBOL, type PricingRule } from '../shared/pricing-config';

type PriceResolution = {
  price: number;
  source: string;
  metadata: Record<string, unknown>;
};

type AssetRow = {
  id: string;
  contract_address: string;
  symbol: string | null;
  name: string | null;
};

type CoinGeckoSimplePriceResponse = Record<
  string,
  {
    usd?: number;
  }
>;

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

async function fetchCoinGeckoPrices(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) {
    return new Map<string, number>();
  }

  const apiKey = process.env.COINGECKO_API_KEY;
  const headers: Record<string, string> = {};

  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }

  const uniqueIds = Array.from(new Set(ids));
  const query = encodeURIComponent(uniqueIds.join(','));

  const data = (await fetchJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${query}&vs_currencies=usd`,
    headers
  )) as CoinGeckoSimplePriceResponse;

  const out = new Map<string, number>();

  for (const id of uniqueIds) {
    const price = data?.[id]?.usd;
    if (typeof price === 'number' && Number.isFinite(price)) {
      out.set(id, price);
    }
  }

  return out;
}

async function resolveCoinGeckoBasePrices(
  client: ReturnType<typeof createPgClient>
): Promise<{
  xlm: PriceResolution;
  btc: PriceResolution;
  coinGeckoPrices: Map<string, number>;
}> {
  const configuredIds = Object.values(PRICING_RULES_BY_SYMBOL)
    .filter((rule): rule is Extract<PricingRule, { kind: 'coingecko' }> => rule.kind === 'coingecko')
    .map((rule) => rule.id);

  const requiredIds = Array.from(new Set(['stellar', 'bitcoin', ...configuredIds]));

  try {
    const prices = await fetchCoinGeckoPrices(requiredIds);

    const xlmPrice = prices.get('stellar');
    if (xlmPrice === undefined) {
      throw new Error('Missing stellar price in CoinGecko response');
    }

    const btcPrice = prices.get('bitcoin');
    if (btcPrice === undefined) {
      throw new Error('Missing bitcoin price in CoinGecko response');
    }

    return {
      xlm: {
        price: xlmPrice,
        source: 'coingecko_xlm_usd',
        metadata: {
          confidence: 'high',
          method: 'direct_native_price',
        },
      },
      btc: {
        price: btcPrice,
        source: 'coingecko_btc_usd',
        metadata: {
          confidence: 'high',
          method: 'direct_btc_price',
        },
      },
      coinGeckoPrices: prices,
    };
  } catch (error) {
    const dbXlm = await getLatestPriceBySource(client, 'coingecko_xlm_usd');
    const dbBtc = await getLatestPriceBySource(client, 'coingecko_btc_usd');

    const xlmFallback =
      dbXlm ??
      getOptionalNumberEnv('MANUAL_XLM_USD') ??
      getOptionalNumberEnv('XLM_USD_FALLBACK') ??
      0.165416;

    const btcFallback =
      dbBtc ??
      getOptionalNumberEnv('MANUAL_BTC_USD') ??
      getOptionalNumberEnv('BTC_USD_FALLBACK') ??
      69846;

    return {
      xlm: {
        price: xlmFallback,
        source: dbXlm !== null ? 'db_cached_xlm_usd' : 'manual_xlm_fallback',
        metadata: {
          confidence: dbXlm !== null ? 'medium' : 'low',
          method:
            dbXlm !== null
              ? 'latest_db_fallback_after_api_failure'
              : 'manual_fallback_after_api_failure',
          fallbackFrom: 'coingecko_xlm_usd',
          error: error instanceof Error ? error.message : String(error),
        },
      },
      btc: {
        price: btcFallback,
        source: dbBtc !== null ? 'db_cached_btc_usd' : 'manual_btc_fallback',
        metadata: {
          confidence: dbBtc !== null ? 'medium' : 'low',
          method:
            dbBtc !== null
              ? 'latest_db_fallback_after_api_failure'
              : 'manual_fallback_after_api_failure',
          fallbackFrom: 'coingecko_btc_usd',
          error: error instanceof Error ? error.message : String(error),
        },
      },
      coinGeckoPrices: new Map<string, number>(),
    };
  }
}

function resolveStableFallback(symbol: string): {
  priceUsd: number | null;
  source: string;
  metadata: Record<string, unknown>;
} {
  const stable = inferStablePrice(symbol);

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

function resolvePriceFromRule(params: {
  symbol: string;
  rule: PricingRule | undefined;
  xlm: PriceResolution;
  btc: PriceResolution;
  coinGeckoPrices: Map<string, number>;
}): {
  priceUsd: number | null;
  source: string;
  metadata: Record<string, unknown>;
} {
  const { symbol, rule, xlm, btc, coinGeckoPrices } = params;

  if (!rule) {
    return resolveStableFallback(symbol);
  }

  if (rule.kind === 'stable') {
    return {
      priceUsd: rule.priceUsd,
      source: 'manual_stable',
      metadata: {
        confidence: 'high',
        method: 'pricing_config_stable',
      },
    };
  }

  if (rule.kind === 'manual') {
    const envPrice = getOptionalNumberEnv(rule.envVar);

    if (envPrice !== null) {
      return {
        priceUsd: envPrice,
        source: 'manual_env',
        metadata: {
          confidence: 'medium',
          method: 'pricing_config_manual_env',
          envVar: rule.envVar,
        },
      };
    }

    if (rule.fallbackPriceUsd !== undefined) {
      return {
        priceUsd: rule.fallbackPriceUsd,
        source: 'manual_fallback',
        metadata: {
          confidence: 'medium',
          method: 'pricing_config_manual_fallback',
          envVar: rule.envVar,
        },
      };
    }

    return {
      priceUsd: null,
      source: 'unknown',
      metadata: {},
    };
  }

  if (rule.kind === 'proxy') {
    if (rule.base === 'BTC') {
      return {
        priceUsd: btc.price,
        source: 'coingecko_btc_proxy',
        metadata: {
          confidence: 'medium',
          method: 'pricing_config_proxy',
          proxy: 'BTC',
          upstreamSource: btc.source,
          upstreamMetadata: btc.metadata,
        },
      };
    }

    if (rule.base === 'XLM') {
      return {
        priceUsd: xlm.price,
        source: 'coingecko_xlm_proxy',
        metadata: {
          confidence: 'medium',
          method: 'pricing_config_proxy',
          proxy: 'XLM',
          upstreamSource: xlm.source,
          upstreamMetadata: xlm.metadata,
        },
      };
    }
  }

  if (rule.kind === 'coingecko') {
    const direct = coinGeckoPrices.get(rule.id);
    if (direct !== undefined) {
      return {
        priceUsd: direct,
        source: 'coingecko_direct',
        metadata: {
          confidence: 'high',
          method: 'pricing_config_coingecko',
          coinGeckoId: rule.id,
        },
      };
    }

    if (rule.fallbackEnvVar) {
      const envPrice = getOptionalNumberEnv(rule.fallbackEnvVar);
      if (envPrice !== null) {
        return {
          priceUsd: envPrice,
          source: 'manual_env_fallback',
          metadata: {
            confidence: 'medium',
            method: 'pricing_config_coingecko_env_fallback',
            coinGeckoId: rule.id,
            envVar: rule.fallbackEnvVar,
          },
        };
      }
    }

    return {
      priceUsd: null,
      source: 'unknown',
      metadata: {},
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

    const { xlm, btc, coinGeckoPrices } = await resolveCoinGeckoBasePrices(client);

    let inserted = 0;

    for (const asset of assetsRes.rows as AssetRow[]) {
      const symbol = (asset.symbol ?? '').trim();
      if (!symbol) continue;

      const rule = PRICING_RULES_BY_SYMBOL[symbol] ?? PRICING_RULES_BY_SYMBOL[symbol.toUpperCase()];

      const resolved = resolvePriceFromRule({
        symbol,
        rule,
        xlm,
        btc,
        coinGeckoPrices,
      });

      if (resolved.priceUsd === null) {
        continue;
      }

      await client.query(
        `
        insert into asset_prices (asset_id, price_usd, source, observed_at, metadata)
        values ($1, $2, $3, $4, $5::jsonb)
        on conflict (asset_id, source, observed_at) do nothing
        `,
        [
          asset.id,
          resolved.priceUsd,
          resolved.source,
          observedAt,
          JSON.stringify(resolved.metadata),
        ]
      );

      inserted += 1;
      console.log(symbol || asset.contract_address, '=>', resolved.priceUsd, resolved.source);
    }

    console.log({
      completedAt: observedAt,
      inserted,
      nativeUsd: xlm.price,
      nativeSource: xlm.source,
      btcUsd: btc.price,
      btcSource: btc.source,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});