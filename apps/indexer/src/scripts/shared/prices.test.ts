// node --import tsx --test  (apps/indexer `pnpm test`) — phase A2 max-age rule
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshPriceSql, priceMaxAgeMinutes, tvlFromLegs } from './prices';

test('priceMaxAgeMinutes: PRICE_MAX_AGE_MINUTES > FRESHNESS_STALE_AFTER_MINUTES > 45; garbage → 45', () => {
  const saved = { p: process.env.PRICE_MAX_AGE_MINUTES, f: process.env.FRESHNESS_STALE_AFTER_MINUTES };
  try {
    delete process.env.PRICE_MAX_AGE_MINUTES; delete process.env.FRESHNESS_STALE_AFTER_MINUTES;
    assert.equal(priceMaxAgeMinutes(), 45);
    process.env.FRESHNESS_STALE_AFTER_MINUTES = '30';
    assert.equal(priceMaxAgeMinutes(), 30);
    process.env.PRICE_MAX_AGE_MINUTES = '20';
    assert.equal(priceMaxAgeMinutes(), 20);
    process.env.PRICE_MAX_AGE_MINUTES = 'abc';
    assert.equal(priceMaxAgeMinutes(), 45);
    process.env.PRICE_MAX_AGE_MINUTES = '-5';
    assert.equal(priceMaxAgeMinutes(), 45);
  } finally {
    if (saved.p === undefined) delete process.env.PRICE_MAX_AGE_MINUTES; else process.env.PRICE_MAX_AGE_MINUTES = saved.p;
    if (saved.f === undefined) delete process.env.FRESHNESS_STALE_AFTER_MINUTES; else process.env.FRESHNESS_STALE_AFTER_MINUTES = saved.f;
  }
});

test('freshPriceSql: integer minutes, alias respected, no injection surface', () => {
  const saved = process.env.PRICE_MAX_AGE_MINUTES;
  try {
    process.env.PRICE_MAX_AGE_MINUTES = '45';
    assert.equal(freshPriceSql('ap'), "ap.observed_at > now() - interval '45 minutes'");
    assert.equal(freshPriceSql('ap2'), "ap2.observed_at > now() - interval '45 minutes'");
    process.env.PRICE_MAX_AGE_MINUTES = '12.7';
    assert.match(freshPriceSql(), /interval '13 minutes'/);
  } finally {
    if (saved === undefined) delete process.env.PRICE_MAX_AGE_MINUTES; else process.env.PRICE_MAX_AGE_MINUTES = saved;
  }
});

test('tvlFromLegs: null when no leg is priced, partial sum otherwise, 0 for an empty pool', () => {
  assert.deepEqual(tvlFromLegs([{ amount: 100, priceUsd: null }, { amount: 50, priceUsd: null }]), { tvlUsd: null, priced: 0, total: 2 });
  assert.deepEqual(tvlFromLegs([{ amount: 100, priceUsd: 2 }, { amount: 50, priceUsd: null }]), { tvlUsd: 200, priced: 1, total: 2 });
  assert.deepEqual(tvlFromLegs([{ amount: 100, priceUsd: 2 }, { amount: 50, priceUsd: 1 }]), { tvlUsd: 250, priced: 2, total: 2 });
  assert.deepEqual(tvlFromLegs([]), { tvlUsd: 0, priced: 0, total: 0 });
  assert.deepEqual(tvlFromLegs([{ amount: null, priceUsd: 2 }]), { tvlUsd: null, priced: 0, total: 1 });
});
