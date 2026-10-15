// node --import tsx --test  (apps/indexer `pnpm test`)
// Price-sources v2, phase B — simulated pool quote, pure parts. Fixtures are the
// read-only `estimate_swap` / `get_slot0` simulations of 2026-10-14 13:31–13:33Z
// (05-phase-b-design.md §3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slot0Price, stableMidPrice, stableQuoteSizeUnits } from './pool-quote';

const close = (a: number | null, b: number, tol: number) => {
  assert.ok(a !== null, 'price is null');
  assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);
};

test('stable mid: USDGLO/USDC — fee cancels in the geometric mean (0.999924 vs Reflector 0.999919)', () => {
  // in 1 USDGLO (7 dec) → 998 923 USDC units; in 1 USDC → 999 075 USDGLO units; fee 10 bps
  const mid = stableMidPrice({ in01: 1_000_000n, out01: 998_923n, in10: 1_000_000n, out10: 999_075n, dec0: 7, dec1: 7 });
  close(mid, 0.999924, 2e-6);
});

test('stable mid: xSolvBTC/SolvBTC (8/8 dec) = 1.000125 SolvBTC per xSolvBTC', () => {
  const mid = stableMidPrice({ in01: 1_000_000n, out01: 999_124n, in10: 1_000_000n, out10: 998_874n, dec0: 8, dec1: 8 });
  close(mid, 1.000125, 2e-6);
});

test('stable mid: PYUSD/USDC and USDC/yUSDC (1 bp fee) match the Reflector Stellar DEX feed within 0.01 %', () => {
  close(stableMidPrice({ in01: 1_000_000n, out01: 998_889n, in10: 1_000_000n, out10: 999_109n, dec0: 7, dec1: 7 }), 0.99989, 1e-5);
  // yUSDC in USDC: the pool is [USDC, yUSDC]; price of yUSDC = 1 / (yUSDC per USDC)
  const yPerUsdc = stableMidPrice({ in01: 1_000_000n, out01: 1_000_327n, in10: 1_000_000n, out10: 999_473n, dec0: 7, dec1: 7 });
  close(yPerUsdc === null ? null : 1 / yPerUsdc, 0.999573, 1e-5);
});

test('stable mid: decimals mismatch scales, a zero leg (rounding) yields null', () => {
  // token0 with 8 dec, token1 with 7 dec, 1:1 value → 0.1 token0 (10^7) → 0.1 token1 (10^6)
  close(stableMidPrice({ in01: 10_000_000n, out01: 1_000_000n, in10: 1_000_000n, out10: 10_000_000n, dec0: 8, dec1: 7 }), 1, 1e-12);
  assert.equal(stableMidPrice({ in01: 1_000n, out01: 0n, in10: 1_000n, out10: 1n, dec0: 7, dec1: 7 }), null);
});

test('slot0 → price: aquarius-btc-usdc-clpool sqrt_price_x96 → 82 648 USDC per BTC (tick 113229 → 82 647)', () => {
  const p = slot0Price(22776987064936450563033883650067n, 7, 7);
  close(p, 82648.2, 0.5);
  assert.ok(Math.abs(p! - 1.0001 ** 113229) / p! < 1e-4);
  assert.equal(slot0Price(0n, 7, 7), null);
});

test('quote size: 0.1 token in base units', () => {
  assert.equal(stableQuoteSizeUnits(7), 1_000_000n);
  assert.equal(stableQuoteSizeUnits(8), 10_000_000n);
  assert.equal(stableQuoteSizeUnits(0), 1n);
});
