// node --import tsx --test  (apps/indexer `pnpm test`)
// Price-sources v2, phase B — the lightweight production rule: Reflector primary,
// A1 fallback / cross-check, tolerances 1 % / 3 %, primary kept on disagreement,
// sanity band for the single-source NAV token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySanityBand,
  combineSources,
  crossCheck,
  crossCheckTolerancePct,
  describeCrossCheck,
  mergeFallbacks,
  stableQuoteResolution,
} from './price-select';
import type { PoolQuoteRead } from './pool-quote';
import type { OracleRead } from './reflector';
import type { XlmPriceSelection } from './xlm-price';

const now = new Date('2026-10-14T14:03:14Z');
const fresh = (priceUsd: number): OracleRead => ({
  ok: true,
  price: { priceUsd, observedAt: new Date('2026-10-14T14:00:00Z'), ageSec: 194 },
  pegged: false,
  decimals: 14,
});
const absent: OracleRead = { ok: false, reason: 'stale oracle timestamp (975s > 900s)' };
const onchain = (priceUsd: number | null, source = 'onchain_aquarius_btc_eth'): XlmPriceSelection =>
  priceUsd === null
    ? { priceUsd: null, source: 'none', kind: 'none', metadata: { method: 'no_qualifying_source', rejected: [{ pool: 'p', reason: 'thin pool' }] } }
    : { priceUsd, source, kind: 'onchain', metadata: { method: 'pool_implied_vs_eth', rejected: [] } };

test('tolerances: 3 % for the volatile set, 1 % for dollar / NAV coins', () => {
  assert.equal(crossCheckTolerancePct('BTC'), 3);
  assert.equal(crossCheckTolerancePct('native'), 3);
  assert.equal(crossCheckTolerancePct('USDGLO'), 1);
  assert.equal(crossCheckTolerancePct('USTRY'), 1);
});

test('Reflector fresh + pool agrees → reflector primary, crossCheck traced, two sources', () => {
  // 2026-10-14 14:03Z: Reflector CEX BTC 82541.65 vs BTC/ETH two-hop 81822.76 (−0.87 %)
  const out = combineSources({ symbol: 'BTC', reflector: { read: fresh(82541.65), source: 'reflector_cex_btc' }, fallback: onchain(81822.76) });
  assert.equal(out.priceUsd, 82541.65);
  assert.equal(out.source, 'reflector_cex_btc');
  assert.equal(out.kind, 'reflector');
  const check = out.metadata.crossCheck as { agrees: boolean; deviationPct: number; tolerancePct: number; secondarySource: string };
  assert.equal(check.agrees, true);
  assert.equal(check.tolerancePct, 3);
  assert.ok(Math.abs(check.deviationPct - 0.8785) < 0.001);
  assert.equal(check.secondarySource, 'onchain_aquarius_btc_eth');
  assert.equal(out.metadata.sourcesQualified, 2);
  assert.match(describeCrossCheck(check as never), /cross-check onchain_aquarius_btc_eth 81822.76 \+0.88 % ok/);
});

test('disagreement → primary KEPT, agrees:false, never averaged, log says DISAGREES', () => {
  const out = combineSources({ symbol: 'USDGLO', reflector: { read: fresh(0.9999), source: 'reflector_sdex_usdglo' }, fallback: onchain(1.03, 'onchain_x') });
  assert.equal(out.priceUsd, 0.9999);
  const check = out.metadata.crossCheck as { agrees: boolean; deviationPct: number };
  assert.equal(check.agrees, false);
  assert.ok(check.deviationPct < -2.9);
  assert.match(describeCrossCheck(check as never), /DISAGREES .* primary kept/);
  assert.equal(out.metadata.confidence, 'medium');
});

test('Reflector absent → the A1 selection stands alone (one source); absent + no pool → null', () => {
  const out = combineSources({ symbol: 'BTC', reflector: { read: absent, source: 'reflector_cex_btc' }, fallback: onchain(81822.76) });
  assert.equal(out.priceUsd, 81822.76);
  assert.equal(out.source, 'onchain_aquarius_btc_eth');
  assert.equal(out.metadata.sourcesQualified, 1);
  assert.deepEqual(out.metadata.reflector, { source: 'reflector_cex_btc', absent: 'stale oracle timestamp (975s > 900s)' });
  const none = combineSources({ symbol: 'PYUSD', reflector: { read: absent, source: 'reflector_sdex_pyusd' }, fallback: onchain(null) });
  assert.equal(none.priceUsd, null);
  assert.equal(none.metadata.sourcesQualified, 0);
});

test('manual env override wins over Reflector and is traced as manual', () => {
  const manual: XlmPriceSelection = { priceUsd: 2, source: 'manual_env', kind: 'manual', metadata: { method: 'manual_override_env' } };
  const out = combineSources({ symbol: 'USDGLO', reflector: { read: fresh(0.9999), source: 'reflector_sdex_usdglo' }, fallback: manual });
  assert.equal(out.priceUsd, 2);
  assert.equal(out.source, 'manual_env');
});

test('no Reflector entry at all (not listed) → fallback with reflector:null', () => {
  const out = combineSources({ symbol: 'USDY', reflector: null, fallback: onchain(1.1338, 'onchain_aquarius_usdy_usdc') });
  assert.equal(out.priceUsd, 1.1338);
  assert.equal(out.metadata.reflector, null);
  assert.equal(out.metadata.sourcesQualified, 1);
});

test('crossCheck helper: null without a secondary price', () => {
  assert.equal(crossCheck('BTC', 1, null), null);
  assert.equal(crossCheck('BTC', 1, { source: 'x', priceUsd: null }), null);
});

test('USDY sanity band: [1.00, 1.25] and |Δ 24 h| ≤ 2 % vs our previous row', () => {
  const band = { minUsd: 1.0, maxUsd: 1.25, maxMove24hPct: 2 };
  const prev = { priceUsd: 1.1338, observedAt: new Date('2026-10-13T14:00:00Z') };
  assert.deepEqual(applySanityBand(1.14, band, prev, now), { ok: true, reason: null });
  assert.match(applySanityBand(1.30, band, prev, now).reason ?? '', /out of band/);
  assert.match(applySanityBand(0.98, band, prev, now).reason ?? '', /out of band/);
  assert.match(applySanityBand(1.17, band, prev, now).reason ?? '', /moved 3.1\d % .* > 2 %/);
  // previous row older than 36 h → no move check (history gap), band only
  const old = { priceUsd: 1.0, observedAt: new Date('2026-10-10T14:00:00Z') };
  assert.deepEqual(applySanityBand(1.17, band, old, now), { ok: true, reason: null });
  assert.deepEqual(applySanityBand(5, undefined, prev, now), { ok: true, reason: null });
});

// ── Stable-pool quote as fallback / cross-check (USDGLO, PYUSD, yUSDC — 2026-10-15) ──
// Fixtures: aquarius-usdglo-usdc-pool quote mid 0.999924 (200 731 USD side), Reflector 0.999918.
const quoteRead = (priceInQuote: number, quoteReserveUsd: number): PoolQuoteRead => ({
  ok: true,
  quote: { priceInQuote, assetReserve: 224_739.8, quoteReserve: quoteReserveUsd, feeBps: 10, method: 'stable_estimate_swap', sellEstimate: null, quoteReserveUsd, deepEnough: quoteReserveUsd >= 50_000 },
});
const noCp = onchain(null);
const quoteOf = (q: PoolQuoteRead) => stableQuoteResolution({ symbol: 'USDGLO', pool: 'aquarius-usdglo-usdc-pool', quoteSymbol: 'USDC', quote: q, quoteUsd: 1 });

test('stable quote: Reflector fresh + quote agrees → reflector primary, quote traced as cross-check, two sources', () => {
  const fallback = mergeFallbacks(noCp, quoteOf(quoteRead(0.999924, 200_731)));
  assert.equal(fallback.source, 'quote_aquarius_usdglo_usdc');
  const out = combineSources({ symbol: 'USDGLO', reflector: { read: fresh(0.999918), source: 'reflector_sdex_usdglo' }, fallback });
  assert.equal(out.priceUsd, 0.999918);
  assert.equal(out.source, 'reflector_sdex_usdglo');
  const check = out.metadata.crossCheck as { agrees: boolean; secondarySource: string; tolerancePct: number };
  assert.equal(check.agrees, true);
  assert.equal(check.secondarySource, 'quote_aquarius_usdglo_usdc');
  assert.equal(check.tolerancePct, 1);
  assert.equal(out.metadata.sourcesQualified, 2);
});

test('stable quote: Reflector absent → the quote is the price (one source), never null', () => {
  const fallback = mergeFallbacks(noCp, quoteOf(quoteRead(0.999924, 200_731)));
  const out = combineSources({ symbol: 'USDGLO', reflector: { read: absent, source: 'reflector_sdex_usdglo' }, fallback });
  assert.equal(out.priceUsd, 0.999924);
  assert.equal(out.source, 'quote_aquarius_usdglo_usdc');
  assert.equal(out.kind, 'quote');
  assert.equal(out.metadata.sourcesQualified, 1);
});

test('stable quote: deviation > 1 % → primary kept, agrees:false traced', () => {
  const fallback = mergeFallbacks(noCp, quoteOf(quoteRead(1.015, 200_731)));
  const out = combineSources({ symbol: 'USDGLO', reflector: { read: fresh(0.999918), source: 'reflector_sdex_usdglo' }, fallback });
  assert.equal(out.priceUsd, 0.999918);
  const check = out.metadata.crossCheck as { agrees: boolean; deviationPct: number };
  assert.equal(check.agrees, false);
  assert.ok(check.deviationPct < -1.4);
  assert.match(describeCrossCheck(check as never), /DISAGREES with quote_aquarius_usdglo_usdc/);
});

test('stable quote: thin pool → no fallback (Reflector absent → null with the reason), no cross-check when primary', () => {
  const thin = quoteOf(quoteRead(0.999924, 12_000));
  assert.equal(thin.priceUsd, null);
  const fallback = mergeFallbacks(noCp, thin);
  assert.equal(fallback.priceUsd, null);
  assert.match(JSON.stringify(fallback.metadata.rejected), /thin pool \(12000 USD on the USDC side < 50000\)/);
  const none = combineSources({ symbol: 'USDGLO', reflector: { read: absent, source: 'reflector_sdex_usdglo' }, fallback });
  assert.equal(none.priceUsd, null);
  const primary = combineSources({ symbol: 'USDGLO', reflector: { read: fresh(0.999918), source: 'reflector_sdex_usdglo' }, fallback });
  assert.equal(primary.priceUsd, 0.999918);
  assert.equal(primary.metadata.crossCheck, null);
  assert.equal(primary.metadata.sourcesQualified, 1);
  const failed = quoteOf({ ok: false, reason: 'rate_limited: 429' });
  assert.equal(failed.priceUsd, null);
});
