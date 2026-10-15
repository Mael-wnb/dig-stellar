// apps/indexer/src/scripts/discovery/qa-price-sources.ts
//
// READ-ONLY price-sources comparison (price-sources v2, phase B). For every
// mainnet asset of the `assets` table it prints, side by side:
//   served   — the latest asset_prices row (what the product shows today) and its age
//   R-CEX    — Reflector "External CEXs & DEXs" feed (USD), when the ticker is listed
//   R-SDEX   — Reflector "Stellar Mainnet DEX" feed (USDC → USD at 1 by convention)
//   Blend    — the Blend pool oracle(s) holding the asset (parity; `peg` = hard-coded)
//   CP       — deepest qualifying constant-product pool ratio from reserve_snapshots (A1 rule)
//   Q        — simulated pool quote (stable: estimate_swap mid; concentrated: slot0)
//   two-hop  — BTC via the BTC/ETH cp pool with ETH from Reflector (founder arbitration §1)
// Nothing is written. RPC: resolveRpcUrl() (operator endpoint first), strictly
// sequential, one account fetch, 429 / timeout → the cell reads "—" with the reason.
//
//   pnpm -C apps/indexer tsx src/scripts/discovery/qa-price-sources.ts
import 'dotenv/config';
import { resolveRpcUrl } from '../../lib/rpc-config';
import { createPgClient } from '../shared/db';
import { getEnv } from './00-common';
import { SorobanReader } from '../shared/soroban-read';
import {
  ORACLE_MAX_AGE_SEC,
  REFLECTOR_CEX_CONTRACT,
  REFLECTOR_SDEX_CONTRACT,
  readOraclePrice,
  type OracleRead,
} from '../shared/reflector';
import { discoverBlendOracles, readBlendOraclePrice, type BlendPoolOracle } from '../shared/blend-oracle';
import { readConcentratedPoolPrice, readStablePoolQuote, type PoolQuoteRead } from '../shared/pool-quote';
import { loadPoolReserveSets } from '../shared/xlm-price-db';
import { candidatesFromPools, judgeCandidate, type PoolReserveSet } from '../shared/xlm-price';

type AssetRow = { id: string; symbol: string; contract_address: string; decimals: number };
type ServedRow = { asset_id: string; price_usd: string; source: string; observed_at: Date };

// Reflector CEX tickers for our symbols (Other(Symbol)); `native` is XLM.
const CEX_TICKER: Record<string, string> = { native: 'XLM', BTC: 'BTC', ETH: 'ETH', USDC: 'USDC', EURC: 'EURC' };

// Simulated-quote pools (slug → asset / quote symbols); the pool type comes from entities.metadata.
const QUOTE_POOLS: Array<{ slug: string; asset: string; quote: string }> = [
  { slug: 'aquarius-xsolvbtc-solvbtc-pool', asset: 'xSolvBTC', quote: 'SolvBTC' },
  { slug: 'aquarius-usdglo-usdc-pool', asset: 'USDGLO', quote: 'USDC' },
  { slug: 'aquarius-pyusd-usdc-pool', asset: 'PYUSD', quote: 'USDC' },
  { slug: 'aquarius-usdc-yusdc-pool', asset: 'yUSDC', quote: 'USDC' },
  { slug: 'aquarius-native-yxlm-pool', asset: 'yXLM', quote: 'native' },
  { slug: 'aquarius-btc-usdc-clpool', asset: 'BTC', quote: 'USDC' },
];
const BTC_ETH_POOL = 'aquarius-btc-eth-pool';

const fmt = (n: number | null | undefined, digits = 6): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : n >= 1000 ? n.toFixed(2) : n.toFixed(digits);
const pct = (a: number | null, b: number | null): string =>
  a === null || b === null || b === 0 ? '—' : `${(((a - b) / b) * 100).toFixed(2)} %`;
const oracleCell = (r: OracleRead | null): string =>
  r === null ? '—' : r.ok ? `${fmt(r.price.priceUsd)} (${r.price.ageSec}s${r.pegged ? ', peg' : ''})` : `— (${r.reason})`;

async function main() {
  const now = new Date();
  const client = createPgClient();
  await client.connect();
  const rpcUrl = resolveRpcUrl();
  const reader = new SorobanReader({ rpcUrl, sourceAccount: getEnv('STELLAR_SOURCE_ACCOUNT') });
  try {
    const assets = (
      await client.query<AssetRow>(`select id, symbol, contract_address, decimals from assets where chain = 'stellar-mainnet' order by symbol`)
    ).rows;
    const bySymbol = new Map(assets.map((a) => [a.symbol, a]));
    const byContract = new Map(assets.map((a) => [a.contract_address, a]));

    const served = new Map(
      (
        await client.query<ServedRow>(
          `select distinct on (asset_id) asset_id, price_usd, source, observed_at from asset_prices order by asset_id, observed_at desc`
        )
      ).rows.map((r) => [r.asset_id, r])
    );
    const entities = new Map(
      (
        await client.query<{ slug: string; contract_address: string; pool_type: string | null }>(
          `select e.slug, e.contract_address, e.metadata->'info'->>'pool_type' as pool_type from entities e where e.is_active = true`
        )
      ).rows.map((r) => [r.slug, r])
    );

    console.log(`# Price sources comparison — ${now.toISOString()} — rpc ${new URL(rpcUrl).host} — oracle window ${ORACLE_MAX_AGE_SEC}s\n`);

    // 1. Reflector CEX (USD) — XLM first: the two-hop cp candidates need it.
    const cex = new Map<string, OracleRead>();
    for (const [symbol, ticker] of Object.entries(CEX_TICKER)) {
      cex.set(symbol, await readOraclePrice(reader, REFLECTOR_CEX_CONTRACT, { kind: 'other', symbol: ticker }, { now }));
    }
    // 2. Reflector Stellar DEX — only the assets the feed lists (one `assets()` read).
    const sdex = new Map<string, OracleRead>();
    const listed = await reader.read(REFLECTOR_SDEX_CONTRACT, 'assets');
    const sdexListed = new Set<string>();
    if (listed.ok && Array.isArray(listed.value)) {
      for (const entry of listed.value as unknown[]) {
        if (Array.isArray(entry) && entry[0] === 'Stellar' && typeof entry[1] === 'string') sdexListed.add(entry[1]);
      }
    }
    for (const a of assets) {
      if (sdexListed.has(a.contract_address)) {
        sdex.set(a.symbol, await readOraclePrice(reader, REFLECTOR_SDEX_CONTRACT, { kind: 'stellar', contractId: a.contract_address }, { now }));
      }
    }
    // 3. Blend pool oracles.
    const blendPools = [...entities.entries()].filter(([slug]) => slug.startsWith('blend-')).map(([slug, e]) => ({ slug, contractId: e.contract_address }));
    const { oracles, failures } = await discoverBlendOracles(rpcUrl, blendPools);
    for (const f of failures) console.log(`blend oracle discovery failed for ${f.poolSlug}: ${f.error}`);
    const blend = new Map<string, Array<{ pool: string; read: OracleRead }>>();
    for (const oracle of oracles as BlendPoolOracle[]) {
      for (const assetId of oracle.assets) {
        const asset = byContract.get(assetId);
        if (!asset) continue;
        const read = await readBlendOraclePrice(reader, oracle, assetId, now);
        const list = blend.get(asset.symbol) ?? [];
        list.push({ pool: oracle.poolSlug.replace(/^blend-/, '').replace(/-pool$/, ''), read });
        blend.set(asset.symbol, list);
      }
    }
    // 4. Constant-product candidates from the DB reserve batches (A1 rule).
    const sets: PoolReserveSet[] = await loadPoolReserveSets(client);
    const xlmUsd = cex.get('native')?.ok ? (cex.get('native') as Extract<OracleRead, { ok: true }>).price.priceUsd : null;
    const cp = (symbol: string): { price: number | null; pool: string | null; note: string | null } => {
      const verdicts = candidatesFromPools(symbol, sets, xlmUsd).map((c) => judgeCandidate(c, now, null));
      const ok = verdicts.filter((v) => v.priceUsd !== null).sort((a, b) => b.candidate.quoteReserveUsd - a.candidate.quoteReserveUsd);
      if (ok.length) return { price: ok[0].priceUsd, pool: ok[0].candidate.pool, note: null };
      return { price: null, pool: null, note: verdicts[0]?.rejected ?? 'no cp pool' };
    };
    // 5. Simulated quotes.
    const quotes = new Map<string, { pool: string; read: PoolQuoteRead; quoteUsd: number | null }>();
    for (const qp of QUOTE_POOLS) {
      const entity = entities.get(qp.slug);
      const asset = bySymbol.get(qp.asset);
      const quote = bySymbol.get(qp.quote);
      if (!entity || !asset || !quote) continue;
      const tokens = await reader.read(entity.contract_address, 'get_tokens');
      const order = tokens.ok && Array.isArray(tokens.value) ? (tokens.value as string[]) : [];
      const assetIdx = order.indexOf(asset.contract_address);
      const quoteIdx = order.indexOf(quote.contract_address);
      if (assetIdx < 0 || quoteIdx < 0) {
        quotes.set(qp.asset, { pool: qp.slug, read: { ok: false, reason: 'get_tokens: asset/quote not found' }, quoteUsd: null });
        continue;
      }
      const quoteUsd = qp.quote === 'USDC' ? 1 : sdex.get(qp.quote)?.ok ? (sdex.get(qp.quote) as Extract<OracleRead, { ok: true }>).price.priceUsd : qp.quote === 'native' ? xlmUsd : null;
      const params = {
        contractId: entity.contract_address,
        assetIdx: assetIdx as 0 | 1,
        quoteIdx: quoteIdx as 0 | 1,
        assetDecimals: asset.decimals,
        quoteDecimals: quote.decimals,
        quoteUsd: quoteUsd ?? 0,
      };
      const read = entity.pool_type === 'concentrated' ? await readConcentratedPoolPrice(reader, params) : await readStablePoolQuote(reader, params);
      quotes.set(qp.asset, { pool: qp.slug, read, quoteUsd });
    }
    // 6. BTC two-hop via the BTC/ETH cp pool (live reserves) with ETH from Reflector CEX.
    let btcViaEth: { price: number | null; note: string } = { price: null, note: 'no pool' };
    const btcEth = entities.get(BTC_ETH_POOL);
    const ethUsd = cex.get('ETH')?.ok ? (cex.get('ETH') as Extract<OracleRead, { ok: true }>).price.priceUsd : null;
    if (btcEth && ethUsd !== null) {
      const t = await reader.read(btcEth.contract_address, 'get_tokens');
      const r = await reader.read(btcEth.contract_address, 'get_reserves');
      const btc = bySymbol.get('BTC');
      const eth = bySymbol.get('ETH');
      if (t.ok && r.ok && Array.isArray(t.value) && Array.isArray(r.value) && btc && eth) {
        const order = t.value as string[];
        const res = r.value as bigint[];
        const bi = order.indexOf(btc.contract_address);
        const ei = order.indexOf(eth.contract_address);
        if (bi >= 0 && ei >= 0) {
          const btcRes = Number(res[bi]) / 10 ** btc.decimals;
          const ethRes = Number(res[ei]) / 10 ** eth.decimals;
          const quoteUsd = ethRes * ethUsd;
          const price = (ethRes / btcRes) * ethUsd;
          btcViaEth = quoteUsd >= 50_000 ? { price, note: `ETH side ${Math.round(quoteUsd)} USD` } : { price: null, note: `thin: ETH side ${Math.round(quoteUsd)} USD < 50 000 (would be ${price.toFixed(2)})` };
        }
      }
    }

    // Table.
    console.log('| Asset | Served (source, age) | R-CEX | R-SDEX | Blend oracle | CP (pool) | Q (pool, depth) | two-hop | Δ served→R | Δ R→pool |');
    console.log('|---|---|---|---|---|---|---|---|---|---|');
    for (const a of assets) {
      const s = served.get(a.id);
      const servedPrice = s ? Number(s.price_usd) : null;
      const servedCell = s ? `${fmt(servedPrice)} (${s.source}, ${Math.round((now.getTime() - new Date(s.observed_at).getTime()) / 60000)} min)` : '—';
      const rc = cex.get(a.symbol) ?? null;
      const rs = sdex.get(a.symbol) ?? null;
      const rPrice = rs?.ok ? rs.price.priceUsd : rc?.ok ? rc.price.priceUsd : null;
      const b = blend.get(a.symbol) ?? [];
      const blendCell = b.length ? b.map((x) => `${x.pool}: ${oracleCell(x.read)}`).join('; ') : '—';
      const c = cp(a.symbol);
      const cpCell = c.price !== null ? `${fmt(c.price)} (${c.pool})` : `— (${c.note})`;
      const q = quotes.get(a.symbol);
      let qCell = '—';
      let qPrice: number | null = null;
      if (q) {
        if (q.read.ok) {
          qPrice = q.quoteUsd !== null ? q.read.quote.priceInQuote * q.quoteUsd : null;
          qCell = `${fmt(qPrice)} (${q.pool}, ${q.read.quote.method}, quote side ${Math.round(q.read.quote.quoteReserveUsd)} USD${q.read.quote.deepEnough ? '' : ' THIN'}${q.read.quote.sellEstimate !== null ? `, sell-est ${fmt(q.read.quote.sellEstimate * (q.quoteUsd ?? 0))}` : ''})`;
        } else qCell = `— (${q.pool}: ${q.read.reason})`;
      }
      const twoHop = a.symbol === 'BTC' ? `${fmt(btcViaEth.price)} (${btcViaEth.note})` : '—';
      const poolPrice = c.price ?? qPrice ?? (a.symbol === 'BTC' ? btcViaEth.price : null);
      console.log(`| ${a.symbol} | ${servedCell} | ${oracleCell(rc)} | ${oracleCell(rs)} | ${blendCell} | ${cpCell} | ${qCell} | ${twoHop} | ${pct(rPrice, servedPrice)} | ${pct(poolPrice, rPrice)} |`);
    }
    console.log(`\nreader: ${reader.stats.calls} simulations, ${reader.stats.retries} retries, ${reader.stats.failures} failures; reserve batches in DB: ${sets.length} (newest ${sets.map((s) => s.observedAt.getTime()).length ? new Date(Math.max(...sets.map((s) => s.observedAt.getTime()))).toISOString() : 'none'}); blend oracles: ${oracles.map((o) => `${o.poolSlug}→${o.oracleId.slice(0, 8)}`).join(', ')}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
