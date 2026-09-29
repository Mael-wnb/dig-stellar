// apps/indexer/src/scripts/ingest/62-price-reference-assets.ts
//
// Step 1 of job:refresh — one asset_prices row per priced asset per run.
// price-sources v2 (2026-09-29): CoinGecko is called ONLY when a key is configured
// (keyless access is blocked from datacenter IPs); every other asset is priced by
// the shared selection (shared/xlm-price.ts): manual env override > CoinGecko (if
// called) > deepest on-chain constant-product pool vs USDC or vs XLM within guards >
// null. No hard-coded price exists any more: no qualifying source → no row + a log.
//
// E2 (Lot E): install RPC latency/error capture BEFORE any HTTP-touching import.
import '../../lib/ops-capture';

import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { getOptionalNumberEnv } from '../shared/env';
import { inferStablePrice } from '../shared/pricing';
import { PRICING_RULES_BY_SYMBOL, type PricingRule } from '../shared/pricing-config';
import { loadPoolReserveSets, resolveAssetPrice } from '../shared/xlm-price-db';
import type { PoolReserveSet, XlmPriceSelection } from '../shared/xlm-price';

type Resolution = {
  priceUsd: number | null;
  source: string;
  kind: string;
  metadata: Record<string, unknown>;
};

type AssetRow = {
  id: string;
  contract_address: string;
  symbol: string | null;
  name: string | null;
};

type CoinGeckoSimplePriceResponse = Record<string, { usd?: number }>;

// ── CoinGecko: only with a key ───────────────────────────────────────────────
// Pro plan: pro-api.coingecko.com + x-cg-pro-api-key (docs.coingecko.com/reference/authentication).
// The former Demo shape (api.coingecko.com + x-cg-demo-api-key, COINGECKO_API_KEY) is kept
// for compatibility. No key → no call at all (a 5 s budget bounds a slow answer).
const COINGECKO_TIMEOUT_MS = 5_000;

function coinGeckoConfig(): { baseUrl: string; headers: Record<string, string>; plan: 'pro' | 'demo' } | null {
  const pro = process.env.COINGECKO_PRO_API_KEY?.trim();
  if (pro) return { baseUrl: 'https://pro-api.coingecko.com/api/v3', headers: { 'x-cg-pro-api-key': pro }, plan: 'pro' };
  const demo = process.env.COINGECKO_API_KEY?.trim();
  if (demo) return { baseUrl: 'https://api.coingecko.com/api/v3', headers: { 'x-cg-demo-api-key': demo }, plan: 'demo' };
  return null;
}

async function fetchJson(url: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COINGECKO_TIMEOUT_MS);
  const res = await fetch(url, { headers, signal: controller.signal }).finally(() => clearTimeout(timeout));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} on ${url}${text ? `\n${text.slice(0, 500)}` : ''}`);
  }
  return res.json();
}

async function fetchCoinGeckoPrices(ids: string[]): Promise<{ prices: Map<string, number>; called: boolean; error: string | null }> {
  const config = coinGeckoConfig();
  if (!config || !ids.length) {
    console.log('coingecko: no API key configured — not called (on-chain pricing only)');
    return { prices: new Map(), called: false, error: null };
  }
  const uniqueIds = Array.from(new Set(ids));
  try {
    const data = (await fetchJson(
      `${config.baseUrl}/simple/price?ids=${encodeURIComponent(uniqueIds.join(','))}&vs_currencies=usd`,
      config.headers
    )) as CoinGeckoSimplePriceResponse;
    const prices = new Map<string, number>();
    for (const id of uniqueIds) {
      const price = data?.[id]?.usd;
      if (typeof price === 'number' && Number.isFinite(price)) prices.set(id, price);
    }
    console.log(`coingecko (${config.plan} key): ${prices.size}/${uniqueIds.length} ids priced`);
    return { prices, called: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`coingecko unavailable: ${message.split('\n')[0]}`);
    return { prices: new Map(), called: true, error: message.split('\n')[0] };
  }
}

// ── Per-asset resolution ─────────────────────────────────────────────────────
function fromSelection(selection: XlmPriceSelection, extra: Record<string, unknown> = {}): Resolution {
  return { priceUsd: selection.priceUsd, source: selection.source, kind: selection.kind, metadata: { ...selection.metadata, ...extra } };
}

async function resolveRule(params: {
  client: ReturnType<typeof createPgClient>;
  symbol: string;
  rule: PricingRule | undefined;
  coinGecko: Map<string, number>;
  xlm: Resolution;
  btcUsd: number | null;
  sets: PoolReserveSet[];
  now: Date;
}): Promise<Resolution> {
  const { client, symbol, rule, coinGecko, xlm, btcUsd, sets, now } = params;
  const onchain = (coingecko: number | null, manualEnvVars: string[]) =>
    resolveAssetPrice(client, { symbol, coingecko, manualEnvVars, xlmUsd: xlm.priceUsd, sets, now });

  if (!rule) {
    const stable = inferStablePrice(symbol);
    if (stable !== null) {
      return { priceUsd: stable, source: 'manual_stable', kind: 'stable', metadata: { confidence: 'high', method: 'hardcoded_stable_assumption' } };
    }
    return { priceUsd: null, source: 'none', kind: 'none', metadata: { method: 'no_pricing_rule' } };
  }

  if (rule.kind === 'stable') {
    return { priceUsd: rule.priceUsd, source: 'manual_stable', kind: 'stable', metadata: { confidence: 'high', method: 'pricing_config_stable' } };
  }

  if (rule.kind === 'manual') {
    // env override > on-chain > null (the former hard-coded fallbackPriceUsd is gone)
    return fromSelection(await onchain(null, [rule.envVar]), rule.note ? { note: rule.note } : {});
  }

  if (rule.kind === 'proxy') {
    if (rule.base === 'XLM') {
      // Same price as native, whatever resolved it; null → skipped.
      return {
        priceUsd: xlm.priceUsd,
        source: xlm.source === 'coingecko_direct' ? 'coingecko_xlm_proxy' : `xlm_proxy:${xlm.source}`,
        kind: xlm.kind,
        metadata: { confidence: xlm.priceUsd === null ? 'none' : 'medium', method: 'pricing_config_proxy', proxy: 'XLM', upstreamSource: xlm.source },
      };
    }
    // BTC proxies: CoinGecko bitcoin when a key answered; else the asset's own
    // on-chain pool (e.g. SolvBTC vs XLM, two hops); else null. Phase B: Reflector.
    if (btcUsd !== null) {
      return { priceUsd: btcUsd, source: 'coingecko_btc_proxy', kind: 'coingecko', metadata: { confidence: 'medium', method: 'pricing_config_proxy', proxy: 'BTC' } };
    }
    return fromSelection(await onchain(null, [`MANUAL_${symbol.toUpperCase()}_USD`]), { proxy: 'BTC', proxyBase: 'none' });
  }

  if (rule.kind === 'coingecko') {
    if (rule.id === 'stellar') return xlm;
    const direct = coinGecko.get(rule.id) ?? null;
    const selection = await onchain(direct, rule.fallbackEnvVar ? [rule.fallbackEnvVar] : []);
    return fromSelection(selection, { coinGeckoId: rule.id });
  }

  return { priceUsd: null, source: 'none', kind: 'none', metadata: { method: 'unknown_rule' } };
}

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const observedAt = nowIso();
    const now = new Date(observedAt);

    const assetsRes = await client.query(
      `
      select id, contract_address, symbol, name
      from assets
      where chain = 'stellar-mainnet'
      order by symbol asc nulls last
      `
    );
    const assets = (assetsRes.rows as AssetRow[]).filter((a) => (a.symbol ?? '').trim());

    // Reserve sets once per run; every asset derives its candidates from them.
    const sets = await loadPoolReserveSets(client);
    console.log(`on-chain reserve sets loaded: ${sets.length} constant-product pools`);

    // CoinGecko once per run, only with a key.
    const coinGeckoIds = Object.values(PRICING_RULES_BY_SYMBOL)
      .filter((rule): rule is Extract<PricingRule, { kind: 'coingecko' }> => rule.kind === 'coingecko')
      .map((rule) => rule.id);
    const cg = await fetchCoinGeckoPrices(Array.from(new Set(['bitcoin', ...coinGeckoIds])));

    // XLM first: two-hop candidates of every other asset depend on it.
    const xlm = fromSelection(
      await resolveAssetPrice(client, {
        symbol: 'native',
        coingecko: cg.prices.get('stellar') ?? null,
        manualEnvVars: ['MANUAL_XLM_USD', 'XLM_USD_FALLBACK'],
        xlmUsd: null,
        sets,
        now,
      }),
      cg.error ? { coingeckoError: cg.error } : {}
    );
    const btcUsd = cg.prices.get('bitcoin') ?? null;

    let inserted = 0;
    const summary: Record<string, string> = {};

    for (const asset of assets) {
      const symbol = (asset.symbol ?? '').trim();
      const rule = PRICING_RULES_BY_SYMBOL[symbol] ?? PRICING_RULES_BY_SYMBOL[symbol.toUpperCase()];
      const resolved =
        symbol === 'native' ? xlm : await resolveRule({ client, symbol, rule, coinGecko: cg.prices, xlm, btcUsd, sets, now });

      console.log(`price source: ${symbol} ${resolved.kind} (${resolved.source}) => ${resolved.priceUsd ?? 'null'}`);
      summary[symbol] = resolved.priceUsd === null ? 'null' : resolved.source;

      if (resolved.priceUsd === null) {
        // No qualifying source: no row is written (never an invented value). Readers
        // keep the asset's last row until the max-age rule (phase A2) hides it.
        const rejectedList = (resolved.metadata.rejected as unknown[] | undefined) ?? [];
        const why = rejectedList.length
          ? `rejected: ${JSON.stringify(rejectedList)}`
          : 'no candidate pool (no constant-product pool quotes it vs USDC or XLM)';
        console.warn(`no qualifying source for ${symbol}: skipped this run (${why})`);
        continue;
      }

      await client.query(
        `
        insert into asset_prices (asset_id, price_usd, source, observed_at, metadata)
        values ($1, $2, $3, $4, $5::jsonb)
        on conflict (asset_id, source, observed_at) do nothing
        `,
        [asset.id, resolved.priceUsd, resolved.source, observedAt, JSON.stringify(resolved.metadata)]
      );
      inserted += 1;
    }

    console.log({
      completedAt: observedAt,
      inserted,
      skipped: assets.length - inserted,
      coingeckoCalled: cg.called,
      nativeUsd: xlm.priceUsd,
      nativeSource: xlm.source,
      sources: summary,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
