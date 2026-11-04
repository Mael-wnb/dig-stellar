// node --import tsx --test  (apps/indexer `pnpm test`) — Lot PRE (PRE2 A3, PRE3)
process.env.HORIZON_TRADES_URL = 'https://provider.example.com/v1/AbCdEf0123456789AbCdEf0123456789AbCdEf01';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPoolTrades } from './fetch-pool-trades';

const POOL = 'a468d41d8e9b8f3c7209651608b74b7db7ac9952dcae0cdf24871d1d9c7b0088';
const NOW = Date.now();

function trade(ageMs: number, xlm: string) {
  return {
    ledger_close_time: new Date(NOW - ageMs).toISOString(),
    base_amount: xlm,
    base_asset_type: 'native',
    counter_amount: '0',
    counter_asset_type: 'credit_alphanum4',
    counter_asset_code: 'USDC',
  };
}

test('fetchPoolTrades: sums the pages inside the 24 h window and stops at the first older trade', async () => {
  const pages = [
    { _embedded: { records: [trade(1_000, '100'), trade(2_000, '50')] }, _links: { next: { href: 'https://provider.example.com/p2' } } },
    { _embedded: { records: [trade(3_000, '10'), trade(25 * 3600 * 1000, '999')] }, _links: { next: { href: 'https://provider.example.com/p3' } } },
  ];
  const seen: string[] = [];
  const result = await fetchPoolTrades({ poolId: POOL, feeBp: 30, xlmUsd: 0.5 }, async (url) => {
    seen.push(url);
    return pages.shift()!;
  });
  assert.deepEqual(result, { volume24hUsd: 80, fees24hUsd: 80 * 0.003, trades24h: 3 });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].startsWith(`https://provider.example.com/v1/AbCdEf0123456789AbCdEf0123456789AbCdEf01/liquidity_pools/${POOL}/trades?`), true);
});

test('fetchPoolTrades: a failed page returns null, never the partial sum', async () => {
  let calls = 0;
  const result = await fetchPoolTrades({ poolId: POOL, feeBp: 30, xlmUsd: 0.5 }, async () => {
    calls += 1;
    if (calls === 1) {
      return { _embedded: { records: [trade(1_000, '100')] }, _links: { next: { href: 'https://provider.example.com/p2' } } };
    }
    throw new Error('HTTP 504 on provider.example.com');
  });
  assert.equal(result, null);
  assert.equal(calls, 2);
});

test('fetchPoolTrades: a base that is not an absolute URL returns null without throwing, and the warning carries no key', async () => {
  const saved = process.env.HORIZON_TRADES_URL;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: unknown) => warnings.push(String(msg));
  try {
    process.env.HORIZON_TRADES_URL = 'provider.example.com/v1/AbCdEf0123456789AbCdEf0123456789AbCdEf01';
    let calls = 0;
    const result = await fetchPoolTrades({ poolId: POOL, feeBp: 30, xlmUsd: 0.5 }, async () => {
      calls += 1;
      return { _embedded: { records: [] } };
    });
    assert.equal(result, null);
    assert.equal(calls, 0);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].includes('HORIZON_TRADES_URL'), true);
    assert.equal(warnings[0].includes('AbCdEf0123456789'), false);
  } finally {
    console.warn = originalWarn;
    process.env.HORIZON_TRADES_URL = saved;
  }
});

test('fetchPoolTrades: a blank HORIZON_TRADES_URL falls back to HORIZON_URL', async () => {
  const saved = { trades: process.env.HORIZON_TRADES_URL, horizon: process.env.HORIZON_URL };
  try {
    process.env.HORIZON_TRADES_URL = '';
    process.env.HORIZON_URL = 'https://horizon.example.org';
    const seen: string[] = [];
    await fetchPoolTrades({ poolId: POOL, feeBp: 30, xlmUsd: 0.5 }, async (url) => {
      seen.push(url);
      return { _embedded: { records: [] } };
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].startsWith(`https://horizon.example.org/liquidity_pools/${POOL}/trades?`), true);
  } finally {
    process.env.HORIZON_TRADES_URL = saved.trades;
    process.env.HORIZON_URL = saved.horizon;
  }
});
