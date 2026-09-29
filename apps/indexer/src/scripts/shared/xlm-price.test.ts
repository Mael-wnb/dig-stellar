// node --import tsx --test  (apps/indexer `pnpm test`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compute24hChangePct,
  selectXlmPrice,
  type XlmOnchainCandidate,
} from './xlm-price';

const now = new Date('2026-09-29T15:30:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

const soroswap: XlmOnchainCandidate = {
  source: 'onchain_soroswap_xlm_usdc',
  pool: 'soroswap-native-usdc-pair',
  xlmReserve: 296_314.5757818,
  usdcReserve: 66_772.2333829, // prod reserves 2026-09-29 15:30Z → ≈ 0.2253
  observedAt: minutesAgo(5),
};
const sdex: XlmOnchainCandidate = {
  source: 'onchain_sdex_xlm_usdc',
  pool: 'stellar-native-native-usdc-pool',
  xlmReserve: 2_000_000,
  usdcReserve: 450_000, // deeper → preferred
  observedAt: minutesAgo(5),
};

test('CoinGecko answered → coingecko wins over on-chain', () => {
  const r = selectXlmPrice({ now, manualOverride: null, coingecko: 0.2261, reference: null, onchain: [soroswap, sdex] });
  assert.equal(r.kind, 'coingecko');
  assert.equal(r.source, 'coingecko_direct');
  assert.equal(r.priceUsd, 0.2261);
});

test('CoinGecko failed → deepest on-chain pool within guards', () => {
  const r = selectXlmPrice({ now, manualOverride: null, coingecko: null, reference: null, onchain: [soroswap, sdex] });
  assert.equal(r.kind, 'onchain');
  assert.equal(r.source, 'onchain_sdex_xlm_usdc');
  assert.equal(r.priceUsd, 0.225);
  assert.equal(r.metadata.pool, 'stellar-native-native-usdc-pool');
});

test('deepest pool stale → next deepest passing pool', () => {
  const staleSdex = { ...sdex, observedAt: minutesAgo(90) };
  const r = selectXlmPrice({ now, manualOverride: null, coingecko: null, reference: null, onchain: [soroswap, staleSdex] });
  assert.equal(r.source, 'onchain_soroswap_xlm_usdc');
  assert.ok(Math.abs((r.priceUsd ?? 0) - 0.2253) < 0.001);
  assert.deepEqual(
    (r.metadata.rejected as Array<{ pool: string }>).map((x) => x.pool),
    ['stellar-native-native-usdc-pool']
  );
});

test('guards: stale reserves, thin pool, deviation vs a fresh reference → null, never a constant', () => {
  const stale = selectXlmPrice({ now, manualOverride: null, coingecko: null, reference: null, onchain: [{ ...soroswap, observedAt: minutesAgo(61) }] });
  assert.equal(stale.priceUsd, null);
  assert.equal(stale.kind, 'none');

  const thin = selectXlmPrice({ now, manualOverride: null, coingecko: null, reference: null, onchain: [{ ...soroswap, usdcReserve: 49_999, xlmReserve: 221_900 }] });
  assert.equal(thin.priceUsd, null);
  assert.match(String((thin.metadata.rejected as Array<{ reason: string }>)[0].reason), /thin pool/);

  const deviating = selectXlmPrice({
    now, manualOverride: null, coingecko: null,
    reference: { priceUsd: 0.30, observedAt: minutesAgo(30) }, // fresh reference, pool says 0.2253 → −25 %
    onchain: [soroswap],
  });
  assert.equal(deviating.priceUsd, null);
  assert.match(String((deviating.metadata.rejected as Array<{ reason: string }>)[0].reason), /deviation/);
});

test('deviation guard is not applied against a reference older than 6h', () => {
  const r = selectXlmPrice({
    now, manualOverride: null, coingecko: null,
    reference: { priceUsd: 0.30, observedAt: minutesAgo(6 * 60 + 1) },
    onchain: [soroswap],
  });
  assert.equal(r.kind, 'onchain');
});

test('manual override wins and is traced as manual', () => {
  const r = selectXlmPrice({ now, manualOverride: 0.21, coingecko: 0.2261, reference: null, onchain: [sdex] });
  assert.equal(r.kind, 'manual');
  assert.equal(r.source, 'manual_env');
  assert.equal(r.priceUsd, 0.21);
});

test('nothing at all → null with an explicit reason', () => {
  const r = selectXlmPrice({ now, manualOverride: null, coingecko: null, reference: null, onchain: [] });
  assert.equal(r.priceUsd, null);
  assert.equal(r.source, 'none');
  assert.equal(r.metadata.method, 'no_qualifying_source');
});

test('24h change: nearest stored point within ±30 min, else null', () => {
  const latest = { priceUsd: 0.225, observedAt: now, source: 'onchain_sdex_xlm_usdc' };
  const history = [
    { priceUsd: 0.25, observedAt: new Date(now.getTime() - 24 * 3_600_000 - 10 * 60_000), source: 'coingecko_direct' },
    { priceUsd: 0.20, observedAt: new Date(now.getTime() - 20 * 3_600_000), source: 'coingecko_direct' },
  ];
  const r = compute24hChangePct(latest, history, now);
  assert.equal(r.basis?.priceUsd, 0.25);
  assert.equal(Math.round((r.changePct ?? 0) * 100) / 100, -10);

  const far = compute24hChangePct(latest, [{ priceUsd: 0.25, observedAt: new Date(now.getTime() - 26 * 3_600_000), source: 'x' }], now);
  assert.equal(far.changePct, null);
  assert.equal(compute24hChangePct(null, history, now).changePct, null);
});

// ── price-sources v2: generic selection for any asset ────────────────────────
import { candidatesFromPools, judgeCandidate, pairCandidate, selectPrice, type PoolReserveSet } from './xlm-price';

const sets: PoolReserveSet[] = [
  { pool: 'aquarius-ustry-usdc-pool', venue: 'aquarius', observedAt: minutesAgo(5), reserves: [{ symbol: 'USTRY', amount: 500_000 }, { symbol: 'USDC', amount: 540_000 }] },
  { pool: 'soroswap-ustry-usdc-pair', venue: 'soroswap', observedAt: minutesAgo(5), reserves: [{ symbol: 'USTRY', amount: 20_000 }, { symbol: 'USDC', amount: 21_800 }] },
  { pool: 'soroswap-native-eurc-pair', venue: 'soroswap', observedAt: minutesAgo(5), reserves: [{ symbol: 'native', amount: 400_000 }, { symbol: 'EURC', amount: 80_000 }] },
  { pool: 'aquarius-xsolvbtc-solvbtc-pool', venue: 'aquarius', observedAt: minutesAgo(5), reserves: [{ symbol: 'xSolvBTC', amount: 10 }, { symbol: 'SolvBTC', amount: 10 }] },
  { pool: 'stellar-native-native-usdc-pool', venue: 'sdex', observedAt: minutesAgo(5), reserves: [{ symbol: 'native', amount: 12_478_024 }, { symbol: 'USDC', amount: 2_828_992 }] },
];

test('candidates: direct vs USDC, two hops vs XLM only when XLM/USD is known, three hops never', () => {
  const ustry = candidatesFromPools('USTRY', sets, 0.2267);
  assert.deepEqual(ustry.map((c) => [c.source, c.hops, c.quoteKind]), [
    ['onchain_aquarius_ustry_usdc', 1, 'usdc'],
    ['onchain_soroswap_ustry_usdc', 1, 'usdc'],
  ]);
  const eurcWithXlm = candidatesFromPools('EURC', sets, 0.2267);
  assert.equal(eurcWithXlm.length, 1);
  assert.equal(eurcWithXlm[0].source, 'onchain_soroswap_eurc_xlm');
  assert.equal(eurcWithXlm[0].hops, 2);
  assert.ok(Math.abs(eurcWithXlm[0].quoteReserveUsd - 400_000 * 0.2267) < 1e-6);
  assert.equal(candidatesFromPools('EURC', sets, null).length, 0, 'no XLM/USD → no two-hop candidate');
  assert.equal(candidatesFromPools('xSolvBTC', sets, 0.2267).length, 0, 'xSolvBTC/SolvBTC is three hops → no candidate');
  const xlm = candidatesFromPools('native', sets, null);
  assert.deepEqual(xlm.map((c) => c.source), ['onchain_sdex_xlm_usdc'], 'XLM keeps its hotfix source name');
});

test('generic selection: deepest quote side wins across pools; guards unchanged; null otherwise', () => {
  const ustry = selectPrice({ asset: 'USTRY', now, manualOverride: null, manualEnvVar: 'MANUAL_USTRY_USD', coingecko: null, reference: null, onchain: candidatesFromPools('USTRY', sets, 0.2267) });
  assert.equal(ustry.source, 'onchain_aquarius_ustry_usdc');
  assert.equal(ustry.priceUsd, 1.08);
  assert.equal(ustry.metadata.hops, 1);

  const eurc = selectPrice({ asset: 'EURC', now, manualOverride: null, manualEnvVar: 'MANUAL_EURC_USD', coingecko: null, reference: null, onchain: candidatesFromPools('EURC', sets, 0.2267) });
  assert.equal(eurc.kind, 'onchain');
  assert.ok(Math.abs((eurc.priceUsd ?? 0) - (400_000 * 0.2267) / 80_000) < 1e-9);
  assert.equal(eurc.metadata.method, 'pool_implied_vs_xlm');

  const thin = selectPrice({ asset: 'USTRY', now, manualOverride: null, manualEnvVar: 'x', coingecko: null, reference: null, onchain: candidatesFromPools('USTRY', [sets[1]], null) });
  assert.equal(thin.priceUsd, null, '21.8k USDC side < 50k → null, no exception');

  const nothing = selectPrice({ asset: 'BTC', now, manualOverride: null, manualEnvVar: 'MANUAL_BTC_USD', coingecko: null, reference: null, onchain: candidatesFromPools('BTC', sets, 0.2267) });
  assert.equal(nothing.priceUsd, null);
  assert.equal(nothing.source, 'none');

  const manual = selectPrice({ asset: 'CETES', now, manualOverride: 0.07, manualEnvVar: 'MANUAL_CETES_USD', coingecko: null, reference: null, onchain: [] });
  assert.equal(manual.source, 'manual_env');
  assert.equal(manual.metadata.envVar, 'MANUAL_CETES_USD');
});

test('step 2: pair candidate is judged with the step-1 guards (thin pair → null), third hop → no candidate', () => {
  // prod 2026-09-29 16:30Z: soroswap-ustry-usdc-pair = 46 366.02 USDC / 43 109.49 USTRY → below 50k
  const thin = pairCandidate({ pool: 'soroswap-ustry-usdc-pair', targetSymbol: 'USTRY', targetReserve: 43_109.49, quoteSymbol: 'USDC', quoteReserve: 46_366.02, quotePriceUsd: 1, observedAt: minutesAgo(3) });
  assert.ok(thin);
  const v = judgeCandidate(thin!, now, null);
  assert.equal(v.priceUsd, null);
  assert.match(String(v.rejected), /thin pool/);

  const deep = pairCandidate({ pool: 'soroswap-usdc-eurc-pair', targetSymbol: 'EURC', targetReserve: 246_356.52, quoteSymbol: 'USDC', quoteReserve: 277_674, quotePriceUsd: 1, observedAt: minutesAgo(3) });
  const ok = judgeCandidate(deep!, now, null);
  assert.ok(Math.abs((ok.priceUsd ?? 0) - 1.12712) < 1e-4);
  assert.equal(deep!.source, 'onchain_soroswap_eurc_usdc');

  const viaXlm = pairCandidate({ pool: 'soroswap-native-eurc-pair', targetSymbol: 'EURC', targetReserve: 219_334.32, quoteSymbol: 'native', quoteReserve: 1_091_882.08, quotePriceUsd: 0.226026, observedAt: minutesAgo(3) });
  assert.equal(viaXlm!.hops, 2);
  assert.ok(Math.abs((judgeCandidate(viaXlm!, now, null).priceUsd ?? 0) - 1.1252) < 1e-3);

  assert.equal(pairCandidate({ pool: 'x', targetSymbol: 'ZONE', targetReserve: 1, quoteSymbol: 'EURC', quoteReserve: 1, quotePriceUsd: 1.12, observedAt: now }), null, 'quote must be USDC or XLM');

  const stale = pairCandidate({ pool: 'soroswap-usdc-eurc-pair', targetSymbol: 'EURC', targetReserve: 246_356.52, quoteSymbol: 'USDC', quoteReserve: 277_674, quotePriceUsd: 1, observedAt: minutesAgo(61) });
  assert.equal(judgeCandidate(stale!, now, null).priceUsd, null);
});
