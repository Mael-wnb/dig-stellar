// apps/api/src/modules/wallets/wallets.validation.spec.ts — Lot SEC (G1)
//
// Input validation at the wallet write paths: a malformed address, label or
// userId is a 400 BEFORE any SQL runs (the prisma mock records every call), and
// a valid request still reaches the insert. Also the refresh admission: the
// second refresh of the same wallet inside the cooldown is a 429 and spawns
// nothing.
import { BadRequestException, HttpException } from '@nestjs/common';
import { WalletsService } from './wallets.service';

const USER = '00000000-0000-4000-8000-0000000000aa';
const WALLET_ID = '11111111-1111-4111-8111-111111111111';
const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWLT';

function walletRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: WALLET_ID,
    user_id: USER,
    chain: 'stellar',
    address: G,
    label: null,
    is_primary: true,
    is_active: true,
    is_active_signer: false,
    metadata: {},
    created_at: '2026-10-27T00:00:00Z',
    updated_at: '2026-10-27T00:00:00Z',
    ...overrides,
  };
}

function makeService() {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const handler = async (sql: string, ...args: unknown[]) => {
    calls.push({ sql, args });
    if (sql.includes('select count(*) as count')) return [{ count: 0 }];
    if (sql.includes('insert into user_wallets')) {
      return [walletRow({ address: args[2], label: args[3] })];
    }
    // "does this user already track this address" lookups → none; ownership
    // lookups by id → the fixture wallet.
    if (sql.includes('lower(address)')) return [];
    if (sql.includes('from user_wallets')) return [walletRow()];
    return [];
  };
  const prisma = {
    $queryRawUnsafe: jest.fn(handler),
    $executeRawUnsafe: jest.fn(handler),
  } as never;
  const service = new WalletsService(prisma, {} as never);
  return { service, calls };
}

describe('createWallet — input validation (Lot SEC G1)', () => {
  it.each([
    ['plain text with punctuation', 'not an address; really not'],
    ['short string', 'GABC'],
    ['contract address', 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB'],
    ['over-long string', 'G'.repeat(200)],
    ['array', [G]],
    ['missing', undefined],
  ])('rejects address: %s with 400 and runs no SQL', async (_name, address) => {
    const { service, calls } = makeService();
    await expect(service.createWallet({ address })).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it('rejects a 65-character label with 400 and runs no SQL', async () => {
    const { service, calls } = makeService();
    await expect(
      service.createWallet({ address: G, label: 'x'.repeat(65) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it('rejects a non-string label (array) with 400', async () => {
    const { service } = makeService();
    await expect(service.createWallet({ address: G, label: ['a'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an array userId (repeated query key) with 400 and runs no SQL', async () => {
    const { service, calls } = makeService();
    await expect(
      service.createWallet({ userId: [USER, USER], address: G }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it('rejects a non-string chain with 400', async () => {
    const { service } = makeService();
    await expect(service.createWallet({ address: G, chain: ['stellar'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts a valid G… address with a 64-char label and inserts it', async () => {
    const { service, calls } = makeService();
    const label = 'y'.repeat(64);
    const result = await service.createWallet({ userId: USER, address: G, label });
    expect(result.created).toBe(true);
    const insert = calls.find((c) => c.sql.includes('insert into user_wallets'));
    expect(insert).toBeDefined();
    expect(insert?.args[2]).toBe(G);
    expect(insert?.args[3]).toBe(label);
  });

  it('no session: mints a user and inserts the validated address', async () => {
    const { service, calls } = makeService();
    const result = await service.createWallet({ address: ` ${G} ` });
    expect(result.createdUser).toBe(true);
    expect(calls.find((c) => c.sql.includes('insert into user_wallets'))?.args[2]).toBe(G);
  });
});

describe('read routes — userId type guard (Lot SEC G1)', () => {
  it('getWallets: array userId → 400, no SQL', async () => {
    const { service, calls } = makeService();
    await expect(service.getWallets([USER, USER])).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it('getWallets: absent userId still falls back to the demo account (W1 debt)', async () => {
    const { service, calls } = makeService();
    await service.getWallets(undefined);
    expect(calls[0]?.args[0]).toBe('00000000-0000-0000-0000-000000000001');
  });
});

describe('refreshWallet — admission (Lot SEC G1)', () => {
  function makeRefreshService() {
    const { service, calls } = makeService();
    const spawned: string[] = [];
    // Replace the child-process runners: record, resolve.
    const svc = service as unknown as {
      runWalletBalanceRefreshScript: (id: string) => Promise<void>;
      runWalletBlendPositionsScript: (id: string) => Promise<void>;
    };
    svc.runWalletBalanceRefreshScript = async (id) => {
      spawned.push(`balances:${id}`);
    };
    svc.runWalletBlendPositionsScript = async (id) => {
      spawned.push(`blend:${id}`);
    };
    return { service, calls, spawned };
  }

  it('first refresh runs both scripts; the second within the cooldown is a 429 and spawns nothing', async () => {
    const { service, spawned } = makeRefreshService();

    const first = await service.refreshWallet({ userId: USER, walletId: WALLET_ID });
    expect(first.refreshed).toBe(true);
    expect(spawned).toEqual([`balances:${WALLET_ID}`, `blend:${WALLET_ID}`]);

    let caught: unknown;
    try {
      await service.refreshWallet({ userId: USER, walletId: WALLET_ID });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(429);
    expect((caught as HttpException).getResponse()).toMatchObject({ reason: 'cooldown' });
    expect(spawned).toHaveLength(2);
  });

  it('a failing balance script answers a fixed message, never the child output', async () => {
    const { service } = makeRefreshService();
    const svc = service as unknown as {
      runWalletBalanceRefreshScript: (id: string) => Promise<void>;
    };
    svc.runWalletBalanceRefreshScript = async () => {
      throw new Error('Wallet balance refresh script failed with exit code 1');
    };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      let caught: unknown;
      try {
        await service.refreshWallet({ userId: USER, walletId: WALLET_ID });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect((caught as HttpException).getStatus()).toBe(500);
      expect((caught as HttpException).getResponse()).toMatchObject({
        message: 'Wallet refresh failed. Retry in a minute.',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('array userId on refresh → 400 before ownership lookup', async () => {
    const { service, calls } = makeRefreshService();
    await expect(
      service.refreshWallet({ userId: [USER], walletId: WALLET_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });
});
