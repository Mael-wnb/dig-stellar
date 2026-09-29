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
