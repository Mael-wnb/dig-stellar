// apps/indexer/src/scripts/ingest/62-price-reference-assets.ts
// E2 (Lot E): install RPC latency/error capture BEFORE any HTTP-touching import.
import '../../lib/ops-capture';

import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { getOptionalNumberEnv } from '../shared/env';
import { inferStablePrice } from '../shared/pricing';
import { PRICING_RULES_BY_SYMBOL, type PricingRule } from '../shared/pricing-config';
import { resolveXlmPrice } from '../shared/xlm-price-db';

// price === null means "no qualifying source" — the asset is then skipped (no row),
// never priced with an invented constant (hotfix 2026-09-29).
type PriceResolution = {
  price: number | null;
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

// 5 s budget: keyless CoinGecko is blocked from datacenter IPs (CloudFront 403,
// 2026-09-29); a slow/blocked provider must not stretch the refresh.
const COINGECKO_TIMEOUT_MS = 5_000;

async function fetchJson(url: string, headers?: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COINGECKO_TIMEOUT_MS);
  const res = await fetch(url, { headers, signal: controller.signal }).finally(() => clearTimeout(timeout));

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} on ${url}${text ? `\n${text.slice(0, 500)}` : ''}`);
  }

  return res.json();
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

  // CoinGecko first (keyless, 5 s). A failure is logged once here and handled by
  // the selection below — it is not an error for the step.
  let coinGeckoPrices = new Map<string, number>();
  let coinGeckoError: string | null = null;
  try {
    coinGeckoPrices = await fetchCoinGeckoPrices(requiredIds);
  } catch (error) {
    coinGeckoError = error instanceof Error ? error.message : String(error);
    console.warn(`coingecko unavailable: ${coinGeckoError.split('\n')[0]}`);
  }

  // XLM/USD: manual override > CoinGecko > deepest on-chain XLM/USDC pool within
  // guards > null. Pure rule in shared/xlm-price.ts (unit-tested), DB reads in
  // shared/xlm-price-db.ts. The proxy-XLM assets below follow the same price.
  const selection = await resolveXlmPrice(client, coinGeckoPrices.get('stellar') ?? null, new Date());
  const xlm: PriceResolution = {
    price: selection.priceUsd,
    source: selection.source,
    metadata: {
      ...selection.metadata,
      kind: selection.kind,
      ...(coinGeckoError ? { coingeckoError: coinGeckoError.split('\n')[0] } : {}),
    },
  };
  if (xlm.price === null) {
    console.warn(`xlm price: NO qualifying source (coingecko failed, on-chain guards: ${JSON.stringify(selection.metadata.rejected ?? [])}) — native and XLM proxies skipped this run`);
  }

  // BTC/USD (best effort, proxies only): CoinGecko, else the latest stored BTC-proxy
  // row, else the manual env, else null — never the former hard-coded constant.
  let btc: PriceResolution;
  const btcDirect = coinGeckoPrices.get('bitcoin');
  if (btcDirect !== undefined) {
    btc = { price: btcDirect, source: 'coingecko_btc_usd', metadata: { confidence: 'high', method: 'direct_btc_price' } };
  } else {
    const dbBtc = await getLatestPriceBySource(client, 'coingecko_btc_proxy');
    const envBtc = getOptionalNumberEnv('MANUAL_BTC_USD') ?? getOptionalNumberEnv('BTC_USD_FALLBACK');
    if (dbBtc !== null) {
      btc = { price: dbBtc, source: 'db_cached_btc_usd', metadata: { confidence: 'medium', method: 'latest_db_fallback_after_api_failure', fallbackFrom: 'coingecko_btc_usd', error: coinGeckoError } };
    } else if (envBtc !== null) {
      btc = { price: envBtc, source: 'manual_env', metadata: { confidence: 'medium', method: 'manual_override_env', envVar: 'MANUAL_BTC_USD|BTC_USD_FALLBACK' } };
    } else {
      btc = { price: null, source: 'none', metadata: { method: 'no_qualifying_source', error: coinGeckoError } };
      console.warn('btc price: NO qualifying source — BTC proxies skipped this run');
    }
  }

  return { xlm, btc, coinGeckoPrices };
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
    const confidence = rule.confidence ?? 'medium';
    const note = rule.note ? { note: rule.note } : {};

    if (envPrice !== null) {
      return {
        priceUsd: envPrice,
        source: 'manual_env',
        metadata: {
          confidence,
          method: 'pricing_config_manual_env',
          envVar: rule.envVar,
          ...note,
        },
      };
    }

    if (rule.fallbackPriceUsd !== undefined) {
      return {
        priceUsd: rule.fallbackPriceUsd,
        source: 'manual_fallback',
        metadata: {
          confidence,
          method: 'pricing_config_manual_fallback',
          envVar: rule.envVar,
          ...note,
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
      // Same price as native, whatever resolved it (CoinGecko or on-chain); null → skipped.
      return {
        priceUsd: xlm.price,
        source: xlm.source === 'coingecko_direct' ? 'coingecko_xlm_proxy' : `xlm_proxy:${xlm.source}`,
        metadata: {
          confidence: xlm.price === null ? 'none' : 'medium',
          method: 'pricing_config_proxy',
          proxy: 'XLM',
          upstreamSource: xlm.source,
          upstreamMetadata: xlm.metadata,
        },
      };
    }
  }

  if (rule.kind === 'coingecko') {
    if (rule.id === 'stellar') {
      // native: the shared XLM selection (CoinGecko > on-chain > null) — its
      // fallbackEnvVar is honoured inside the selection as the manual override.
      return { priceUsd: xlm.price, source: xlm.source, metadata: xlm.metadata };
    }
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

    console.log(`xlm price source: ${xlm.metadata.kind} (${xlm.source}) => ${xlm.price ?? 'null'}`);
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