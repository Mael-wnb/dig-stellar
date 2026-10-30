// apps/indexer/src/scripts/ingest/62-price-reference-assets.ts
//
// Step 1 of job:refresh — one asset_prices row per priced asset per run.
// price-sources v2 (2026-09-29): CoinGecko is called ONLY when a key is configured
// (keyless access is blocked from datacenter IPs); every other asset is priced by
// the shared selection (shared/xlm-price.ts): manual env override > CoinGecko (if
// called) > deepest on-chain constant-product pool vs USDC or vs XLM within guards >
// null. No hard-coded price exists any more: no qualifying source → no row + a log.
// Phase B (2026-10-14): Reflector is the PRIMARY source for every asset it covers
// (fresh ≤ 900 s); the selection above becomes the fallback and the cross-check
// (shared/price-select.ts). xSolvBTC = SolvBTC × its StableSwap pool mid. Every
// oracle read goes through the configured RPC, sequentially; a 429 / timeout makes
// the source absent for the run, never the step fail.
//
// E2 (Lot E): install RPC latency/error capture BEFORE any HTTP-touching import.
import '../../lib/ops-capture';

import { recordOpsSample } from '../../lib/ops-metrics';
import { resolveRpcUrl } from '../../lib/rpc-config';
import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { getOptionalNumberEnv } from '../shared/env';
import { readStablePoolQuote } from '../shared/pool-quote';
import {
  applySanityBand,
  combineSources,
  describeCrossCheck,
  mergeFallbacks,
  stableQuoteResolution,
  type PreviousPrice,
  type Resolution,
} from '../shared/price-select';
import type { PoolQuoteRead } from '../shared/pool-quote';
import { inferStablePrice } from '../shared/pricing';
import { PRICING_RULES_BY_SYMBOL, REFLECTOR_CEX_TICKERS, type PricingRule } from '../shared/pricing-config';
import {
  REFLECTOR_CEX_CONTRACT,
  REFLECTOR_SDEX_CONTRACT,
  readOraclePrice,
  reflectorSourceLabel,
  type OracleRead,
} from '../shared/reflector';
import { SorobanReader } from '../shared/soroban-read';
import { loadPoolReserveSets, resolveAssetPrice } from '../shared/xlm-price-db';
import type { PoolReserveSet } from '../shared/xlm-price';

type AssetRow = {
  id: string;
  contract_address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
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
function fromSelection(selection: Resolution, extra: Record<string, unknown> = {}): Resolution {
  return { priceUsd: selection.priceUsd, source: selection.source, kind: selection.kind, metadata: { ...selection.metadata, ...extra } };
}

const absentSelection = (method: string): Resolution => ({ priceUsd: null, source: 'none', kind: 'none', metadata: { method } });

// The A1 selection for one asset: manual override > CoinGecko (with a key) > deepest
// constant-product pool within guards > null. DB-only, no RPC. Used as the fallback
// and the cross-check of the Reflector primary.
async function resolveFallback(params: {
  client: ReturnType<typeof createPgClient>;
  symbol: string;
  rule: PricingRule | undefined;
  coinGecko: Map<string, number>;
  xlm: Resolution;
  ethUsd: number | null;
  sets: PoolReserveSet[];
  now: Date;
}): Promise<Resolution> {
  const { client, symbol, rule, coinGecko, xlm, ethUsd, sets, now } = params;
  const onchain = (coingecko: number | null, manualEnvVars: string[]) =>
    resolveAssetPrice(client, { symbol, coingecko, manualEnvVars, xlmUsd: xlm.priceUsd, ethUsd, sets, now });

  if (!rule) {
    const stable = inferStablePrice(symbol);
    if (stable !== null) {
      return { priceUsd: stable, source: 'manual_stable', kind: 'stable', metadata: { confidence: 'high', method: 'hardcoded_stable_assumption' } };
    }
    return absentSelection('no_pricing_rule');
  }
  if (rule.kind === 'stable') {
    return { priceUsd: rule.priceUsd, source: 'manual_stable', kind: 'stable', metadata: { confidence: 'high', method: 'pricing_config_stable', ...(rule.note ? { note: rule.note } : {}) } };
  }
  if (rule.kind === 'manual') {
    // env override > on-chain > null (the former hard-coded fallbackPriceUsd is gone)
    const sel = await onchain(null, [rule.envVar]);
    return rule.note ? { ...sel, metadata: { ...sel.metadata, note: rule.note } } : sel;
  }
  if (rule.kind === 'oracle') {
    return onchain(null, rule.fallbackEnvVar ? [rule.fallbackEnvVar] : []);
  }
  if (rule.kind === 'proxy') {
    // yXLM: same price as native, whatever resolved it; null → skipped.
    return {
      priceUsd: xlm.priceUsd,
      source: xlm.source === 'coingecko_direct' ? 'coingecko_xlm_proxy' : `xlm_proxy:${xlm.source}`,
      kind: xlm.kind,
      metadata: { confidence: xlm.priceUsd === null ? 'none' : 'medium', method: 'pricing_config_proxy', proxy: rule.base, upstreamSource: xlm.source, sourcesQualified: xlm.metadata.sourcesQualified ?? 1 },
    };
  }
  if (rule.kind === 'coingecko') {
    if (rule.id === 'stellar') return xlm;
    const direct = coinGecko.get(rule.id) ?? null;
    const sel = await onchain(direct, rule.fallbackEnvVar ? [rule.fallbackEnvVar] : []);
    return { ...sel, metadata: { ...sel.metadata, coinGeckoId: rule.id } };
  }
  // 'derived' is resolved in main (needs the base asset's final price and one RPC quote).
  return absentSelection('unknown_rule');
}

// ── Reflector reads (sequential, once per run) ───────────────────────────────
type ReflectorReads = Map<string, { read: OracleRead; source: string }>;

async function readReflector(reader: SorobanReader | null, assets: AssetRow[], now: Date): Promise<ReflectorReads> {
  const reads: ReflectorReads = new Map();
  if (!reader) return reads;
  // Stellar DEX feed: the listed contract ids, one `assets()` read.
  const listed = await reader.read(REFLECTOR_SDEX_CONTRACT, 'assets');
  const sdexListed = new Set<string>();
  if (listed.ok && Array.isArray(listed.value)) {
    for (const entry of listed.value as unknown[]) {
      if (Array.isArray(entry) && entry[0] === 'Stellar' && typeof entry[1] === 'string') sdexListed.add(entry[1]);
    }
  } else {
    console.warn(`reflector: assets() unreadable on the Stellar DEX feed (${listed.ok ? 'shape' : listed.error}) — feed absent this run`);
  }
  // CEX feed first for the USD-quoted majors (XLM, BTC, ETH, EURC; USDC as sanity),
  // Stellar DEX feed for the Stellar tokens it lists (founder rule 2026-10-14 §1).
  for (const asset of assets) {
    const symbol = (asset.symbol ?? '').trim();
    const ticker = REFLECTOR_CEX_TICKERS[symbol];
    if (ticker) {
      const read = await readOraclePrice(reader, REFLECTOR_CEX_CONTRACT, { kind: 'other', symbol: ticker }, { now });
      reads.set(symbol, { read, source: reflectorSourceLabel('cex', symbol) });
      continue;
    }
    if (sdexListed.has(asset.contract_address)) {
      const read = await readOraclePrice(reader, REFLECTOR_SDEX_CONTRACT, { kind: 'stellar', contractId: asset.contract_address }, { now });
      reads.set(symbol, { read, source: reflectorSourceLabel('sdex', symbol) });
    }
  }
  return reads;
}

async function loadPreviousPrice(client: ReturnType<typeof createPgClient>, assetId: string): Promise<PreviousPrice | null> {
  const res = await client.query(
    `select price_usd, observed_at from asset_prices where asset_id = $1 order by observed_at desc limit 1`,
    [assetId]
  );
  if (!res.rowCount) return null;
  const priceUsd = Number(res.rows[0].price_usd);
  return Number.isFinite(priceUsd) ? { priceUsd, observedAt: new Date(res.rows[0].observed_at) } : null;
}

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const observedAt = nowIso();
    const now = new Date(observedAt);

    const assetsRes = await client.query(
      `
      select id, contract_address, symbol, name, decimals
      from assets
      where chain = 'stellar-mainnet'
      order by symbol asc nulls last
      `
    );
    const assets = (assetsRes.rows as AssetRow[]).filter((a) => (a.symbol ?? '').trim());
    const bySymbol = new Map(assets.map((a) => [(a.symbol ?? '').trim(), a]));

    // Reserve sets once per run; every asset derives its candidates from them.
    const sets = await loadPoolReserveSets(client);
    console.log(`on-chain reserve sets loaded: ${sets.length} constant-product pools`);

    // CoinGecko once per run, only with a key.
    const coinGeckoIds = Object.values(PRICING_RULES_BY_SYMBOL)
      .filter((rule): rule is Extract<PricingRule, { kind: 'coingecko' }> => rule.kind === 'coingecko')
      .map((rule) => rule.id);
    const cg = await fetchCoinGeckoPrices(Array.from(new Set(['bitcoin', ...coinGeckoIds])));

    // Reflector once per run (phase B). No source account → oracle disabled, logged, never fatal.
    const sourceAccount = process.env.STELLAR_SOURCE_ACCOUNT ?? '';
    const reader = sourceAccount
      ? new SorobanReader({
          rpcUrl: resolveRpcUrl(),
          sourceAccount,
          onSample: (s) => recordOpsSample({ target: 'price-oracle', ok: s.ok, durationMs: s.durationMs }),
        })
      : null;
    if (!reader) console.warn('reflector: STELLAR_SOURCE_ACCOUNT unset — oracle reads disabled this run');
    const reflector = await readReflector(reader, assets, now);

    // XLM first: two-hop candidates of every other asset depend on it.
    const xlm = combineSources({
      symbol: 'native',
      reflector: reflector.get('native') ?? null,
      fallback: await resolveAssetPrice(client, {
        symbol: 'native',
        coingecko: cg.prices.get('stellar') ?? null,
        manualEnvVars: ['MANUAL_XLM_USD', 'XLM_USD_FALLBACK'],
        xlmUsd: null,
        sets,
        now,
      }),
    });
    if (cg.error) xlm.metadata.coingeckoError = cg.error;

    // ETH second: the BTC/ETH two-hop candidate depends on it.
    const resolved = new Map<string, Resolution>();
    resolved.set('native', xlm);
    const resolveOne = async (asset: AssetRow): Promise<Resolution> => {
      const symbol = (asset.symbol ?? '').trim();
      const rule = PRICING_RULES_BY_SYMBOL[symbol] ?? PRICING_RULES_BY_SYMBOL[symbol.toUpperCase()];
      const ethUsd = resolved.get('ETH')?.priceUsd ?? null;
      if (rule?.kind === 'external') {
        // Lot XO: priced by a protocol-scoped external reader (xoxno-aggregator),
        // not by this step — skipped silently, no row written here.
        return { priceUsd: null, source: 'none', kind: 'none', metadata: { method: 'external_source', external: rule.source } };
      }
      if (rule?.kind === 'derived') {
        return resolveDerived({ client, reader, rule, symbol, asset, bySymbol, resolved, now });
      }
      let fallback = await resolveFallback({ client, symbol, rule, coinGecko: cg.prices, xlm, ethUsd, sets, now });
      if (rule?.kind === 'oracle' && rule.stableQuotePool && fallback.kind !== 'manual') {
        // Dollar coins whose only pool is StableSwap: the pool's mid quote vs USDC is the
        // fallback when Reflector is absent and the cross-check when it is primary.
        const usdc = bySymbol.get('USDC');
        const quote = usdc ? await readPoolQuote({ client, reader, poolSlug: rule.stableQuotePool, asset, quoteAsset: usdc, quoteUsd: 1 }) : { ok: false as const, reason: 'USDC asset row missing' };
        fallback = mergeFallbacks(fallback, stableQuoteResolution({ symbol, pool: rule.stableQuotePool, quoteSymbol: 'USDC', quote, quoteUsd: 1 }));
      }
      const out = rule?.kind === 'stable' ? { ...fromSelection(fallback), metadata: { ...fallback.metadata, sourcesQualified: 1 } } : combineSources({ symbol, reflector: reflector.get(symbol) ?? null, fallback });
      if (symbol === 'USDC') {
        // Sanity only: the product keeps USDC = 1; the Reflector USDC/USD read is traced and flagged beyond ±1 %.
        const r = reflector.get('USDC');
        if (r?.read.ok) {
          const dev = (r.read.price.priceUsd - 1) * 100;
          out.metadata.reflectorUsdcUsd = { priceUsd: r.read.price.priceUsd, deviationPct: Number(dev.toFixed(4)), withinBand: Math.abs(dev) <= 1 };
          if (Math.abs(dev) > 1) console.warn(`USDC/USD on Reflector = ${r.read.price.priceUsd} (${dev.toFixed(2)} % from 1) — convention kept, flagged`);
        }
      }
      if (out.priceUsd !== null && rule && 'sanity' in rule && rule.sanity) {
        const band = applySanityBand(out.priceUsd, rule.sanity, await loadPreviousPrice(client, asset.id), now);
        if (!band.ok) {
          return { priceUsd: null, source: 'none', kind: 'none', metadata: { ...out.metadata, method: 'sanity_band_rejected', rejectedPrice: out.priceUsd, rejectedSource: out.source, reason: band.reason } };
        }
        out.metadata.sanityBand = rule.sanity;
      }
      return out;
    };
    const ordered = [
      ...assets.filter((a) => a.symbol === 'ETH'),
      ...assets.filter((a) => a.symbol !== 'ETH' && a.symbol !== 'native' && PRICING_RULES_BY_SYMBOL[(a.symbol ?? '').trim()]?.kind !== 'derived'),
      ...assets.filter((a) => PRICING_RULES_BY_SYMBOL[(a.symbol ?? '').trim()]?.kind === 'derived'),
    ];
    for (const asset of ordered) resolved.set((asset.symbol ?? '').trim(), await resolveOne(asset));

    let inserted = 0;
    const summary: Record<string, string> = {};

    for (const asset of assets) {
      const symbol = (asset.symbol ?? '').trim();
      const out = resolved.get(symbol);
      if (!out) continue;

      if (out.metadata.method === 'external_source') {
        summary[symbol] = `external:${String(out.metadata.external)}`;
        continue;
      }

      console.log(`price source: ${symbol} ${out.kind} (${out.source}) => ${out.priceUsd ?? 'null'}${describeCrossCheck(out.metadata.crossCheck as never)}`);
      summary[symbol] = out.priceUsd === null ? 'null' : out.source;

      if (out.priceUsd === null) {
        // No qualifying source: no row is written (never an invented value). Readers
        // keep the asset's last row until the max-age rule (phase A2) hides it.
        const rejectedList = (out.metadata.rejected as unknown[] | undefined) ?? [];
        const why = out.metadata.reason
          ? String(out.metadata.reason)
          : rejectedList.length
            ? `rejected: ${JSON.stringify(rejectedList)}`
            : 'no candidate (no oracle listing, no constant-product pool vs USDC / XLM / ETH)';
        console.warn(`no qualifying source for ${symbol}: skipped this run (${why})`);
        continue;
      }

      await client.query(
        `
        insert into asset_prices (asset_id, price_usd, source, observed_at, metadata)
        values ($1, $2, $3, $4, $5::jsonb)
        on conflict (asset_id, source, observed_at) do nothing
        `,
        [asset.id, out.priceUsd, out.source, observedAt, JSON.stringify(out.metadata)]
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
      reflector: reader ? { simulations: reader.stats.calls, retries: reader.stats.retries, failures: reader.stats.failures } : 'disabled',
      sources: summary,
    });
  } finally {
    await client.end();
  }
}

// One StableSwap pool quote (asset vs quoteAsset), pool resolved by slug, token order
// read from the contract. 5 simulations; never throws (a failed read is `ok: false`).
async function readPoolQuote(params: {
  client: ReturnType<typeof createPgClient>;
  reader: SorobanReader | null;
  poolSlug: string;
  asset: AssetRow;
  quoteAsset: AssetRow;
  quoteUsd: number;
}): Promise<PoolQuoteRead> {
  const { client, reader, poolSlug, asset, quoteAsset, quoteUsd } = params;
  if (!reader) return { ok: false, reason: 'oracle reads disabled (no STELLAR_SOURCE_ACCOUNT)' };
  const pool = await client.query(`select contract_address from entities where slug = $1 and is_active`, [poolSlug]);
  if (!pool.rowCount) return { ok: false, reason: `pool ${poolSlug} not found` };
  const contractId = String(pool.rows[0].contract_address);
  const tokens = await reader.read(contractId, 'get_tokens');
  const order = tokens.ok && Array.isArray(tokens.value) ? (tokens.value as string[]) : [];
  const assetIdx = order.indexOf(asset.contract_address);
  const quoteIdx = order.indexOf(quoteAsset.contract_address);
  if (assetIdx < 0 || quoteIdx < 0) return { ok: false, reason: `get_tokens: ${tokens.ok ? 'asset or quote not in the pool' : tokens.error}` };
  return readStablePoolQuote(reader, {
    contractId,
    assetIdx: assetIdx as 0 | 1,
    quoteIdx: quoteIdx as 0 | 1,
    assetDecimals: asset.decimals ?? 7,
    quoteDecimals: quoteAsset.decimals ?? 7,
    quoteUsd,
  });
}

// xSolvBTC = SolvBTC (this run's final price) × the StableSwap mid of its pool.
async function resolveDerived(params: {
  client: ReturnType<typeof createPgClient>;
  reader: SorobanReader | null;
  rule: Extract<PricingRule, { kind: 'derived' }>;
  symbol: string;
  asset: AssetRow;
  bySymbol: Map<string, AssetRow>;
  resolved: Map<string, Resolution>;
  now: Date;
}): Promise<Resolution> {
  const { client, reader, rule, symbol, asset, bySymbol, resolved } = params;
  const base = resolved.get(rule.base);
  const baseAsset = bySymbol.get(rule.base);
  const absent = (reason: string): Resolution => ({ priceUsd: null, source: 'none', kind: 'none', metadata: { method: 'derived_quote', base: rule.base, quotePool: rule.quotePool, reason, sourcesQualified: 0 } });
  if (!base || base.priceUsd === null || !baseAsset) return absent(`${rule.base} has no price this run`);
  const quote = await readPoolQuote({ client, reader, poolSlug: rule.quotePool, asset, quoteAsset: baseAsset, quoteUsd: base.priceUsd });
  if (!quote.ok) return absent(`quote: ${quote.reason}`);
  if (!quote.quote.deepEnough) return absent(`thin pool (${Math.round(quote.quote.quoteReserveUsd)} USD on the ${rule.base} side < 50000)`);
  return {
    priceUsd: base.priceUsd * quote.quote.priceInQuote,
    source: `derived_quote_${rule.quotePool.replace(/-pool$/, '').replace(/^aquarius-/, 'aquarius_').replace(/-/g, '_')}`,
    kind: 'derived',
    metadata: {
      confidence: 'medium',
      method: 'derived_quote',
      base: rule.base,
      baseSource: base.source,
      basePriceUsd: base.priceUsd,
      quotePool: rule.quotePool,
      ratio: quote.quote.priceInQuote,
      quoteMethod: quote.quote.method,
      quoteReserveUsd: quote.quote.quoteReserveUsd,
      feeBps: quote.quote.feeBps,
      // the base carries the independent sources; the ratio has one pool
      sourcesQualified: Number(base.metadata.sourcesQualified ?? 1),
      crossCheck: null,
    },
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
