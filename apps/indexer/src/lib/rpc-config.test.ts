// node --import tsx --test  (apps/indexer `pnpm test`) — RPC endpoint resolution + log masking
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskRpcUrl, resolveRpcUrl } from './rpc-config';

const KEYS = ['STELLAR_RPC_URL', 'SOROBAN_RPC_URL'] as const;

function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>, fn: () => void) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of KEYS) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('resolveRpcUrl: explicit override wins over both env vars', () => {
  withEnv({ STELLAR_RPC_URL: 'https://stellar.example', SOROBAN_RPC_URL: 'https://soroban.example' }, () => {
    assert.equal(resolveRpcUrl('https://override.example'), 'https://override.example');
  });
});

test('resolveRpcUrl: STELLAR_RPC_URL wins over SOROBAN_RPC_URL', () => {
  withEnv({ STELLAR_RPC_URL: 'https://stellar.example', SOROBAN_RPC_URL: 'https://soroban.example' }, () => {
    assert.equal(resolveRpcUrl(), 'https://stellar.example');
  });
});

test('resolveRpcUrl: SOROBAN_RPC_URL used when STELLAR_RPC_URL is unset', () => {
  withEnv({ SOROBAN_RPC_URL: 'https://soroban.example' }, () => {
    assert.equal(resolveRpcUrl(), 'https://soroban.example');
  });
});

test('resolveRpcUrl: blank or whitespace values are skipped, not used', () => {
  withEnv({ STELLAR_RPC_URL: '   ', SOROBAN_RPC_URL: 'https://soroban.example' }, () => {
    assert.equal(resolveRpcUrl(''), 'https://soroban.example');
    assert.equal(resolveRpcUrl('  '), 'https://soroban.example');
  });
});

test('resolveRpcUrl: values are trimmed', () => {
  withEnv({ STELLAR_RPC_URL: '  https://stellar.example \n' }, () => {
    assert.equal(resolveRpcUrl(), 'https://stellar.example');
  });
});

test('resolveRpcUrl: public SDF endpoint is the last resort only', () => {
  withEnv({}, () => {
    assert.equal(resolveRpcUrl(), 'https://mainnet.sorobanrpc.com');
  });
});

test('maskRpcUrl: returns the host only, never a key embedded in the path or query', () => {
  const masked = maskRpcUrl('https://mainnet.stellar.validationcloud.io/v1/SECRET_KEY_123?token=abc');
  assert.equal(masked, 'mainnet.stellar.validationcloud.io');
  assert.ok(!masked.includes('SECRET_KEY_123'));
  assert.ok(!masked.includes('abc'));
});

test('maskRpcUrl: keeps a non-default port, drops userinfo credentials', () => {
  assert.equal(maskRpcUrl('https://user:pass@rpc.example:8443/path'), 'rpc.example:8443');
});

test('maskRpcUrl: unset and unparseable inputs', () => {
  assert.equal(maskRpcUrl(undefined), '(unset)');
  assert.equal(maskRpcUrl(null), '(unset)');
  assert.equal(maskRpcUrl(''), '(unset)');
  assert.equal(maskRpcUrl('not a url with a key /v1/SECRET'), '***');
});
