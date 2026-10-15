// node --import tsx --test  (apps/indexer `pnpm test`)
// Price-sources v2, phase B — sequential Soroban reader, pure parts: error
// classification (429 / timeout / network are retried once, simulation errors are
// not) and the u128 argument encoding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scValToNative } from '@stellar/stellar-sdk';
import { classifyReadError, isRetryable, scU128, scU32 } from './soroban-read';

test('classifyReadError: 429 → rate_limited, timeouts, network, anything else = simulation', () => {
  assert.equal(classifyReadError('Request failed with status code 429'), 'rate_limited');
  assert.equal(classifyReadError('Too Many Requests'), 'rate_limited');
  assert.equal(classifyReadError('timeout of 15000ms exceeded'), 'timeout');
  assert.equal(classifyReadError('ECONNABORTED'), 'timeout');
  assert.equal(classifyReadError('socket hang up'), 'network');
  assert.equal(classifyReadError('getaddrinfo ENOTFOUND rpc.example'), 'network');
  assert.equal(classifyReadError('HostError: Error(WasmVm, MissingValue)'), 'simulation');
});

test('only transient kinds are retried (once); a contract error is final', () => {
  assert.equal(isRetryable('rate_limited'), true);
  assert.equal(isRetryable('timeout'), true);
  assert.equal(isRetryable('network'), true);
  assert.equal(isRetryable('simulation'), false);
  assert.equal(isRetryable('account'), false);
});

test('scU128 / scU32 round-trip through scValToNative, including values above 2^64', () => {
  assert.equal(scValToNative(scU128(1_000_000n)), 1_000_000n);
  assert.equal(scValToNative(scU128((1n << 70n) + 5n)), (1n << 70n) + 5n);
  assert.equal(scValToNative(scU32(1)), 1);
});
