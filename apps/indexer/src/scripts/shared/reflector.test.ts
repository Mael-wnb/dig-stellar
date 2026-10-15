// node --import tsx --test  (apps/indexer `pnpm test`)
// Price-sources v2, phase B — Reflector / SEP-40 oracle reader, pure parts.
// Fixtures are the on-chain reads of 2026-10-14 13:31Z (05-phase-b-design.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xdr, scValToNative } from '@stellar/stellar-sdk';
import {
  ORACLE_MAX_AGE_SEC,
  decodeOraclePrice,
  isPeggedTimestamp,
  judgeOraclePrice,
  oracleAssetScVal,
  reflectorSourceLabel,
  scalePrice,
} from './reflector';

const now = new Date('2026-10-14T13:31:15Z');
const USDC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';

test('Asset enum encoding: Other(Symbol) and Stellar(Address) as Vec[variant, payload]', () => {
  const other = oracleAssetScVal({ kind: 'other', symbol: 'BTC' });
  assert.equal(other.switch(), xdr.ScValType.scvVec());
  assert.deepEqual(scValToNative(other), ['Other', 'BTC']);
  const stellar = oracleAssetScVal({ kind: 'stellar', contractId: USDC });
  assert.deepEqual(scValToNative(stellar), ['Stellar', USDC]);
});

test('scalePrice: 14-decimal i128 without float drift, 7 decimals, negative guard', () => {
  // Reflector CEX BTC 2026-10-14 13:30Z: 82481.46373425797 × 1e14
  assert.equal(scalePrice(8248146373425797000n, 14), 82481.46373425797);
  assert.equal(scalePrice(100084033302586n, 14), 1.00084033302586);
  assert.equal(scalePrice(1870179n, 7), 0.1870179); // Blend fixed-pool oracle, 7 decimals
  assert.equal(scalePrice(-5n, 2), -0.05);
});

test('decodeOraclePrice: PriceData → price + age; None / garbage → null', () => {
  const p = decodeOraclePrice({ price: 8248146373425797000n, timestamp: 1791984600n }, 14, now);
  assert.ok(p);
  assert.equal(p.priceUsd, 82481.46373425797);
  assert.equal(p.observedAt.toISOString(), '2026-10-14T13:30:00.000Z');
  assert.equal(p.ageSec, 75);
  assert.equal(decodeOraclePrice(null, 14, now), null);
  assert.equal(decodeOraclePrice({ price: 0n, timestamp: 1791984600n }, 14, now), null);
  assert.equal(decodeOraclePrice({ price: '1' as unknown as bigint, timestamp: 1n }, 14, now), null);
});

test('freshness guard: ≤ 900 s fresh, older absent with an explicit reason', () => {
  const fresh = decodeOraclePrice({ price: 1n, timestamp: 1791984600n }, 0, now)!;
  assert.deepEqual(judgeOraclePrice(fresh), { fresh: true, reason: null });
  const stale = decodeOraclePrice({ price: 1n, timestamp: BigInt(1791984600 - 900) }, 0, now)!;
  assert.equal(stale.ageSec, 975);
  const verdict = judgeOraclePrice(stale);
  assert.equal(verdict.fresh, false);
  assert.match(verdict.reason ?? '', /975s > 900s/);
  assert.equal(ORACLE_MAX_AGE_SEC, 900);
  assert.equal(judgeOraclePrice(null).fresh, false);
});

test('pegged detection: ledger-time stamp off the 300 s grid near now = peg, grid-aligned = observation', () => {
  // Blend yieldblox oracle 13:55Z: PYUSD ts=1791986142 (age −4 s), native ts=1791986100 (grid)
  const at = new Date(1791986146 * 1000);
  assert.equal(isPeggedTimestamp(new Date(1791986142 * 1000), at), true);
  assert.equal(isPeggedTimestamp(new Date(1791986100 * 1000), at), false);
  // off-grid but old: not a peg stamp, just an odd observation
  assert.equal(isPeggedTimestamp(new Date((1791986142 - 3600) * 1000), at), false);
});

test('source labels', () => {
  assert.equal(reflectorSourceLabel('cex', 'BTC'), 'reflector_cex_btc');
  assert.equal(reflectorSourceLabel('sdex', 'native'), 'reflector_sdex_xlm');
});
