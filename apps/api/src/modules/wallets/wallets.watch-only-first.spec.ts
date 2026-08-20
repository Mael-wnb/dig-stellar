// apps/api/src/modules/wallets/wallets.watch-only-first.spec.ts
//
// Lot AB — watch-only as FIRST wallet. createWallet with an ABSENT userId must
// mint a REAL user (connectWallet recovery pattern) instead of silently
// attaching to the shared demo account (the W1 debt on this path):
//   (a) absent userId → a fresh v4 userId is minted, the row is inserted under
//       it (never the demo UUID), and the response returns that userId with
//       createdUser: true;
//   (b) the minted-first wallet is primary but NEVER an active signer — the
//       non-custodial rule: tracking an address must not create signing power;
//   (c) present userId → prior behavior unchanged (insert under that user,
//       createdUser: false, no minting);
//   (d) an invalid userId still rejects with 400 (no silent minting on typos).
//
// Mock-based (no DB), same fake-prisma routing style as wallets.connect.spec.ts.

import { BadRequestException } from '@nestjs/common';
import { WalletsService } from './wallets.service';

const SESSION_USER = '00000000-0000-4000-8000-0000000000aa';
const DEMO_USER = '00000000-0000-0000-0000-000000000001';
const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWALLET';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Call = { sql: string; args: unknown[] };

function walletRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: SESSION_USER,
    chain: 'stellar',
    address: ADDRESS,
    label: null,
    is_primary: true,
    is_active: true,
    is_active_signer: false,
    metadata: {},
    created_at: '2026-08-20T00:00:00Z',
    updated_at: '2026-08-20T00:00:00Z',
    ...overrides,
  };
}

function kindOf(sql: string): string {
  if (sql.includes('insert into user_wallets')) return 'insert';
  if (sql.includes('select count(*) as count')) return 'count';
  if (sql.includes('is_active_signer = true') && sql.includes('update user_wallets'))
    return 'promote';
  if (sql.includes('where user_id') && sql.includes('lower(address)'))
    return 'scoped-lookup';
  return 'other';
}

function makeService() {
  const calls: Call[] = [];

  const handler = async (sql: string, ...args: unknown[]) => {
    calls.push({ sql, args });
    switch (kindOf(sql)) {
      case 'insert':
        // Echo the bound user_id/is_primary so assertions see what was written.
        return [
          walletRow({ user_id: args[0] as string, is_primary: args[4] as boolean }),
        ];
      case 'count':
        return [{ count: 0 }]; // fresh user: no wallets yet → first is primary
      case 'scoped-lookup':
        return []; // no existing row for the session-user dedupe lookup
      default:
        return [];
    }
  };

  const prisma = {
    $queryRawUnsafe: jest.fn(handler),
    $executeRawUnsafe: jest.fn(handler),
  } as never;

  const service = new WalletsService(prisma);
  return { service, calls };
}

const insertsOf = (calls: Call[]) =>
  calls.filter((c) => kindOf(c.sql) === 'insert');

describe('createWallet — watch-only as first wallet (Lot AB)', () => {
  it('(a) absent userId mints a real user, never the demo account', async () => {
    const { service, calls } = makeService();

    const result = await service.createWallet({
      chain: 'stellar',
      address: ADDRESS,
    });

    const inserts = insertsOf(calls);
    expect(inserts).toHaveLength(1);
    const boundUserId = inserts[0].args[0] as string;

    expect(boundUserId).toMatch(UUID_RE);
    expect(boundUserId).not.toBe(DEMO_USER);

    expect(result.created).toBe(true);
    expect(result.createdUser).toBe(true);
    expect(result.userId).toBe(boundUserId);
    expect(result.wallet.userId).toBe(boundUserId);
  });

  it('(b) the minted-first wallet is primary but never an active signer', async () => {
    const { service, calls } = makeService();

    const result = await service.createWallet({
      chain: 'stellar',
      address: ADDRESS,
    });

    const inserts = insertsOf(calls);
    expect(inserts[0].args[4]).toBe(true); // is_primary: first wallet of its user

    // Non-custodial rule: the create/track path must never touch signer state.
    expect(calls.some((c) => kindOf(c.sql) === 'promote')).toBe(false);
    expect(result.wallet.isActiveSigner).toBe(false);
  });

  it('(c) present userId keeps the prior behavior: no minting, createdUser false', async () => {
    const { service, calls } = makeService();

    const result = await service.createWallet({
      userId: SESSION_USER,
      chain: 'stellar',
      address: ADDRESS,
    });

    const inserts = insertsOf(calls);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toBe(SESSION_USER);

    expect(result.created).toBe(true);
    expect(result.createdUser).toBe(false);
    expect(result.userId).toBe(SESSION_USER);
  });

  it('(d) an invalid userId still rejects with 400 — no silent minting on typos', async () => {
    const { service, calls } = makeService();

    await expect(
      service.createWallet({
        userId: 'not-a-uuid',
        chain: 'stellar',
        address: ADDRESS,
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(insertsOf(calls)).toHaveLength(0);
  });
});
