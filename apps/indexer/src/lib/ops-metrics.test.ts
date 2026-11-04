// node --import tsx --test  (apps/indexer `pnpm test`) — Lot PRE (PRE2 A2, PRE3 F1)
//
// The capture files a request by API shape (path), not by host: the operator
// provider serves Horizon under /v1/<key>/... on the Soroban RPC host.
process.env.STELLAR_RPC_URL = 'https://provider.example.com/v1/AbCdEf0123456789AbCdEf0123456789AbCdEf01';
process.env.HORIZON_URL = 'https://horizon.stellar.org';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOpsTarget, labelOpsMethod } from './ops-metrics';

const KEY = 'AbCdEf0123456789AbCdEf0123456789AbCdEf01';
const POOL = 'a468d41d8e9b8f3c7209651608b74b7db7ac9952dcae0cdf24871d1d9c7b0088';

test('classifyOpsTarget: a trades page on the provider host is horizon, labelled by the path template', () => {
  const url = `https://provider.example.com/v1/${KEY}/liquidity_pools/${POOL}/trades?cursor=123-0&limit=200&order=desc`;
  assert.equal(classifyOpsTarget(url), 'horizon');
  const label = labelOpsMethod(url, 'GET', undefined);
  assert.equal(label, 'GET /liquidity_pools/{id}/trades');
  assert.equal(label.includes(KEY) || label.includes(POOL), false);
});

test('classifyOpsTarget: the same trades page on public Horizon gets the same label (host-agnostic)', () => {
  const url = `https://horizon.stellar.org/liquidity_pools/${POOL}/trades?order=desc&limit=200`;
  assert.equal(classifyOpsTarget(url), 'horizon');
  assert.equal(labelOpsMethod(url, 'GET', undefined), 'GET /liquidity_pools/{id}/trades');
});

test('classifyOpsTarget: public Horizon stays horizon, ids templated, bare resources unchanged', () => {
  const url = 'https://horizon.stellar.org/accounts/GAYPUMZFDKUEUJ4LPTHVXVG2GD5B6AV5GGLYDMSZXCSI4QILQKSY25JI';
  assert.equal(classifyOpsTarget(url), 'horizon');
  assert.equal(labelOpsMethod(url, undefined, undefined), 'GET /accounts/{id}');
  assert.equal(labelOpsMethod('https://horizon.stellar.org/fee_stats', 'GET', undefined), 'GET /fee_stats');
  // The 9 pair-filtered pool reads: resource only, the filter lives in the query.
  assert.equal(
    labelOpsMethod('https://horizon.stellar.org/liquidity_pools?reserves=native%2CUSDC%3AG...&limit=5', 'GET', undefined),
    'GET /liquidity_pools',
  );
});

test('classifyOpsTarget: JSON-RPC on the provider host stays soroban-rpc, labelled by the RPC method', () => {
  const url = `https://provider.example.com/v1/${KEY}`;
  assert.equal(classifyOpsTarget(url), 'soroban-rpc');
  assert.equal(
    labelOpsMethod(url, 'POST', JSON.stringify({ jsonrpc: '2.0', method: 'simulateTransaction', params: {} })),
    'simulateTransaction',
  );
  // No body and no Horizon resource → verb only, never the key segment.
  assert.equal(labelOpsMethod(url, 'GET', undefined), 'GET');
});

test('classifyOpsTarget: price sources and unknown hosts are unchanged', () => {
  assert.equal(classifyOpsTarget('https://api.coingecko.com/api/v3/simple/price?ids=stellar'), 'price-sources');
  assert.equal(classifyOpsTarget('https://example.org/liquidity'), null);
});
