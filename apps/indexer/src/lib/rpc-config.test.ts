// node --import tsx --test  (apps/indexer `pnpm test`) — Lot PRE (PRE2, A1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horizonPathOf, horizonPathTemplateOf, maskHorizonUrl, maskRpcUrl } from './rpc-config';

const KEY = 'AbCdEf0123456789AbCdEf0123456789AbCdEf01';
const POOL = 'a468d41d8e9b8f3c7209651608b74b7db7ac9952dcae0cdf24871d1d9c7b0088';

test('maskHorizonUrl: provider trades page → host + Horizon path, no key, no cursor', () => {
  const url = `https://provider.example.com/v1/${KEY}/liquidity_pools/${POOL}/trades?cursor=277380898758657-0&limit=200&order=desc`;
  const masked = maskHorizonUrl(url);
  assert.equal(masked, `provider.example.com/liquidity_pools/${POOL}/trades`);
  assert.equal(masked.includes(KEY), false);
  assert.equal(masked.includes('cursor'), false);
  assert.equal(horizonPathOf(url), `/liquidity_pools/${POOL}/trades`);
});

test('maskHorizonUrl / maskRpcUrl: base URLs with the key in the path → host only', () => {
  const base = `https://provider.example.com/v1/${KEY}`;
  assert.equal(maskHorizonUrl(base), 'provider.example.com');
  assert.equal(maskRpcUrl(base), 'provider.example.com');
  assert.equal(horizonPathOf(base), null);
  assert.equal(maskHorizonUrl(undefined), '(unset)');
  assert.equal(maskHorizonUrl('not a url'), '***');
});

test('horizonPathTemplateOf: ids become {id}, key segment and query dropped, non-Horizon paths null', () => {
  const key = 'AbCdEf0123456789AbCdEf0123456789AbCdEf01';
  const pool = 'a468d41d8e9b8f3c7209651608b74b7db7ac9952dcae0cdf24871d1d9c7b0088';
  assert.equal(
    horizonPathTemplateOf(`https://provider.example.com/v1/${key}/liquidity_pools/${pool}/trades?cursor=1`),
    '/liquidity_pools/{id}/trades',
  );
  assert.equal(horizonPathTemplateOf('https://horizon.stellar.org/accounts/GABC'), '/accounts/{id}');
  assert.equal(horizonPathTemplateOf('https://horizon.stellar.org/fee_stats'), '/fee_stats');
  assert.equal(horizonPathTemplateOf(`https://provider.example.com/v1/${key}`), null);
  assert.equal(horizonPathTemplateOf('not a url'), null);
});
