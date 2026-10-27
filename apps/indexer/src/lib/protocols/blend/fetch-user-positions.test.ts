// node --import tsx --test  (apps/indexer `pnpm test`)
// Lot RP, RP1.1 — the batched Blend position reader must survive a malformed
// address (user_wallets carried scanner junk such as SQL-injection strings on
// 2026-10-15): valid addresses are resolved, the bad one is reported, nothing
// throws, and no RPC call is made for the bad key. No network: the ledger-entry
// read is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Positions } from '@blend-capital/blend-sdk';
import {
  fetchBlendUsersPositionsBatch,
  isValidBlendUserAddress,
  type BlendPoolContext,
  type LedgerEntriesReader,
} from './fetch-user-positions';

const POOL = 'CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS';
const VALID_ACCOUNT = 'GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD';
const VALID_ACCOUNT_2 = 'GAYPUMZFDKUEUJ4LPTHVXVG2GD5B6AV5GGLYDMSZXCSI4QILQKSY25JI';
const VALID_CONTRACT = 'CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD';
const INJECTION = "user' or '1'='1'--";

// A context with no reserves: the breakdown loop has nothing to iterate, which
// is all this test needs (it exercises key building + mapping, not valuation).
const context = {
  poolId: POOL,
  rpcUrl: 'https://example.invalid',
  pool: { reserves: new Map() },
  oracle: {},
} as unknown as BlendPoolContext;

test('isValidBlendUserAddress: accounts and contracts yes, scanner junk no', () => {
  assert.equal(isValidBlendUserAddress(VALID_ACCOUNT), true);
  assert.equal(isValidBlendUserAddress(VALID_CONTRACT), true);
  assert.equal(isValidBlendUserAddress(INJECTION), false);
  assert.equal(isValidBlendUserAddress(''), false);
  assert.equal(isValidBlendUserAddress('GABC'), false);
});

test('batch: valid addresses resolved, the invalid one reported, no throw, no key sent for it', async () => {
  const sentKeys: string[][] = [];
  const readLedgerEntries: LedgerEntriesReader = async (keys) => {
    sentKeys.push(keys.map((k) => k.toXDR('base64')));
    return { entries: [] }; // no Positions entry → empty position for everyone
  };

  const result = await fetchBlendUsersPositionsBatch({
    context,
    userAddresses: [VALID_ACCOUNT, INJECTION, VALID_ACCOUNT_2],
    readLedgerEntries,
  });

  assert.deepEqual(result.invalidAddresses, [INJECTION]);
  assert.deepEqual([...result.positions.keys()].sort(), [VALID_ACCOUNT, VALID_ACCOUNT_2].sort());
  for (const p of result.positions.values()) {
    assert.equal(p.hasPosition, false);
    assert.equal(p.poolId, POOL);
  }

  // One RPC call, carrying exactly the two valid keys.
  assert.equal(sentKeys.length, 1);
  const expected = [VALID_ACCOUNT, VALID_ACCOUNT_2].map((a) =>
    Positions.ledgerKey(POOL, a).toXDR('base64')
  );
  assert.deepEqual(sentKeys[0].sort(), expected.sort());
});

test('batch: a batch made only of invalid addresses makes no RPC call', async () => {
  let calls = 0;
  const result = await fetchBlendUsersPositionsBatch({
    context,
    userAddresses: [INJECTION, 'not-an-address'],
    readLedgerEntries: async () => {
      calls += 1;
      return { entries: [] };
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.positions.size, 0);
  assert.deepEqual(result.invalidAddresses, [INJECTION, 'not-an-address']);
});

test('batch: an RPC failure still throws (the pool is skipped by the caller)', async () => {
  await assert.rejects(
    fetchBlendUsersPositionsBatch({
      context,
      userAddresses: [VALID_ACCOUNT],
      readLedgerEntries: async () => {
        throw new Error('socket hang up');
      },
    }),
    /socket hang up/
  );
});
