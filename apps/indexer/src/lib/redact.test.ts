// node --import tsx --test  (apps/indexer `pnpm test`) — Lot SEC (G1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from './redact';

const FAKE_KEY = 'AbCdEf0123456789AbCdEf0123456789AbCdEf01';

test('redactSecrets: URL with a key in the path → scheme + host only', () => {
  const out = redactSecrets(`request to https://rpc.example.com/v1/${FAKE_KEY} failed, reason: socket hang up`);
  assert.equal(out, 'request to https://rpc.example.com/[redacted] failed, reason: socket hang up');
  assert.equal(out.includes(FAKE_KEY), false);
});

test('redactSecrets: URL with a key in the query → scheme + host only', () => {
  assert.equal(
    redactSecrets(`GET https://api.example.com/prices?apikey=${FAKE_KEY}&ids=xlm → 429`),
    'GET https://api.example.com/[redacted] → 429',
  );
});

test('redactSecrets: labelled secrets and bare opaque tokens', () => {
  assert.equal(redactSecrets(`Authorization: Bearer ${FAKE_KEY} rejected`), 'Authorization: Bearer [redacted] rejected');
  assert.equal(redactSecrets(`unexpected ${FAKE_KEY} in response`), 'unexpected [redacted] in response');
});

test('redactSecrets: ordinary step messages are untouched', () => {
  const msg = '3/19 failed — blend-main: timeout after 30000ms; aquarius-xlm-usdc: 502';
  assert.equal(redactSecrets(msg), msg);
});
