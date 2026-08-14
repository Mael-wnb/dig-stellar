// apps/api/src/modules/wallets/wallets.connect.spec.ts
//
// W1 — connect-signer must ATTACH to the session account, never fork or switch.
// Red tests for the old behavior (docs/lot-w-wallet-management.md):
//   (a) connect with a session account present creates NO new user — the wallet
//       row is inserted under the SESSION user id, not a fresh randomUUID.
//   (b) connect of an address watched by ANOTHER account, with a session
//       present, never touches that other account (every statement is scoped to
//       the session user; the other account's signer flags stay unreachable).
//   (c) recovery with NO session prefers a signer-owning account,
//       deterministically (explicit ORDER BY); a watch-only-elsewhere match
//       alone forks a fresh account instead of recovering.
//
// Mock-based (no DB), same style as alerts.ownership.spec.ts: a fake prisma
// routes raw SQL by shape, records every (sql, args) pair, and the assertions
// hold the SQL to the scoping rules.

import { BadRequestException } from '@nestjs/common';
import { WalletsService } from './wallets.service';

// Valid v4-form UUIDs (isUuid requires version [1-5] + variant [89ab]).
const SESSION_USER = '00000000-0000-4000-8000-0000000000aa';
const OTHER_USER = '00000000-0000-4000-8000-0000000000bb';
const SIGNER_OWNER = '00000000-0000-4000-8000-0000000000cc';
const WALLET_ID = '11111111-1111-4111-8111-111111111111';
const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWALLET';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Call = { sql: string; args: unknown[] };

function walletRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: WALLET_ID,
    user_id: SESSION_USER,
    chain: 'stellar',
    address: ADDRESS,
    label: null,
    is_primary: false,
    is_active: true,
    is_active_signer: false,
    metadata: {},
    created_at: '2026-08-14T00:00:00Z',
    updated_at: '2026-08-14T00:00:00Z',
    ...overrides,
  };
}

// Classify a statement so tests can route results without parsing SQL.
function kindOf(sql: string): string {
  if (sql.includes('insert into user_wallets')) return 'insert';
  if (sql.includes('select count(*) as count')) return 'count';
  if (sql.includes('is_active_signer = false')) return 'demote';
  if (sql.includes('update user_wallets') && sql.includes('is_active_signer = true'))
    return 'promote';
  if (sql.includes('and is_active_signer = true')) return 'recovery-lookup';
  if (sql.includes('where user_id') && sql.includes('lower(address)'))
    return 'scoped-lookup';
  return 'other';
}

function makeService(
  route: (kind: string, sql: string, args: unknown[]) => unknown
) {
  const calls: Call[] = [];

  const handler = async (sql: string, ...args: unknown[]) => {
    calls.push({ sql, args });
    return route(kindOf(sql), sql, args);
  };

  const prisma = {
    $queryRawUnsafe: jest.fn(handler),
    $executeRawUnsafe: jest.fn(handler),
  } as never;

  const service = new WalletsService(prisma);

  // The overview payload is orthogonal to the attach logic under test.
  jest
    .spyOn(service, 'getWalletsOverview')
    .mockImplementation(async (userId?: string) => ({ userId }) as never);

  return { service, calls };
}

// Default routing: promote/demote echo back scoped rows; insert echoes the
// bound user_id so assertions can see WHOSE account got the row.
function defaultRoute(kind: string, _sql: string, args: unknown[]): unknown {
  switch (kind) {
    case 'insert':
      return [walletRow({ user_id: args[0] as string })];
    case 'count':
      return [{ count: 1 }];
    case 'demote':
      return 0;
    case 'promote':
      return [
        walletRow({
          id: args[0] as string,
          user_id: args[1] as string,
          is_active_signer: true,
        }),
      ];
    default:
      return [];
  }
}

describe('connectWallet — session account present (attach, never fork/switch)', () => {
  it('(a) creates NO new user: the wallet row is inserted under the session userId', async () => {
    const { service, calls } = makeService(defaultRoute); // scoped lookup → []

    const result = await service.connectWallet({
      userId: SESSION_USER,
      chain: 'stellar',
      address: ADDRESS,
    });

    // The address lookup is scoped to the session account, not global.
    const lookup = calls.find((c) => kindOf(c.sql) === 'scoped-lookup');
    expect(lookup).toBeDefined();
    expect(lookup!.sql).toContain('user_id = $1::uuid');
    expect(lookup!.args[0]).toBe(SESSION_USER);

    // The insert lands in the SESSION account — no randomUUID fork.
    const insert = calls.find((c) => kindOf(c.sql) === 'insert');
    expect(insert).toBeDefined();
    expect(insert!.args[0]).toBe(SESSION_USER);

    expect(result.createdUser).toBe(false);
    expect(result.createdWallet).toBe(true);
    expect(result.wallet.userId).toBe(SESSION_USER);
  });

  it('(a2) address already in the session account → promote in place, no insert', async () => {
    const { service, calls } = makeService((kind, sql, args) => {
      if (kind === 'scoped-lookup') {
        return [walletRow({ user_id: SESSION_USER, is_active_signer: false })];
      }
      return defaultRoute(kind, sql, args);
    });

    const result = await service.connectWallet({
      userId: SESSION_USER,
      chain: 'stellar',
      address: ADDRESS,
    });

    expect(calls.find((c) => kindOf(c.sql) === 'insert')).toBeUndefined();
    expect(result.createdUser).toBe(false);
    expect(result.createdWallet).toBe(false);
    expect(result.wallet.isActiveSigner).toBe(true);
    expect(result.wallet.userId).toBe(SESSION_USER);
  });

  it('(b) address watched by ANOTHER account: that account is never touched', async () => {
    // The other account's row exists in the DB, but a session-scoped statement
    // can never reach it — assert every statement binds ONLY the session user.
    const { service, calls } = makeService(defaultRoute);

    const result = await service.connectWallet({
      userId: SESSION_USER,
      chain: 'stellar',
      address: ADDRESS,
    });

    for (const call of calls) {
      // No statement anywhere binds the other account.
      expect(call.args).not.toContain(OTHER_USER);
    }

    // The signer demote/promote pair is user-scoped: the other account's
    // is_active_signer flags are outside every WHERE clause executed.
    const demote = calls.find((c) => kindOf(c.sql) === 'demote');
    expect(demote).toBeDefined();
    expect(demote!.sql).toContain('user_id = $1::uuid');
    expect(demote!.args[0]).toBe(SESSION_USER);

    const promote = calls.find((c) => kindOf(c.sql) === 'promote');
    expect(promote).toBeDefined();
    expect(promote!.sql).toContain('user_id = $2::uuid');
    expect(promote!.args[1]).toBe(SESSION_USER);

    // And the caller stays on their own account.
    expect(result.wallet.userId).toBe(SESSION_USER);
    expect(result.createdUser).toBe(false);
  });

  it('rejects a malformed session userId instead of falling back', async () => {
    const { service } = makeService(defaultRoute);

    await expect(
      service.connectWallet({
        userId: 'not-a-uuid',
        chain: 'stellar',
        address: ADDRESS,
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('connectWallet — no session (recovery)', () => {
  it('(c) recovers the signer-owning account via a deterministic lookup', async () => {
    const { service, calls } = makeService((kind, sql, args) => {
      if (kind === 'recovery-lookup') {
        return [
          walletRow({ user_id: SIGNER_OWNER, is_active_signer: true }),
        ];
      }
      return defaultRoute(kind, sql, args);
    });

    const result = await service.connectWallet({
      chain: 'stellar',
      address: ADDRESS,
    });

    // Signer-only filter + explicit total order → deterministic recovery.
    const lookup = calls.find((c) => kindOf(c.sql) === 'recovery-lookup');
    expect(lookup).toBeDefined();
    expect(lookup!.sql).toContain('is_active_signer = true');
    expect(lookup!.sql).toContain('order by updated_at desc, id asc');
    expect(lookup!.sql).not.toContain('user_id = $');

    expect(result.createdUser).toBe(false);
    expect(result.createdWallet).toBe(false);
    expect(result.wallet.userId).toBe(SIGNER_OWNER);
  });

  it('(c2) a watch-only-elsewhere match alone does NOT recover — forks fresh', async () => {
    // recovery-lookup returns [] (no signer match anywhere; OTHER_USER merely
    // watches the address, which the signer-only WHERE clause excludes).
    const { service, calls } = makeService(defaultRoute);

    const result = await service.connectWallet({
      chain: 'stellar',
      address: ADDRESS,
    });

    const insert = calls.find((c) => kindOf(c.sql) === 'insert');
    expect(insert).toBeDefined();
    const forkedUserId = insert!.args[0] as string;
    expect(forkedUserId).toMatch(UUID_RE);
    expect(forkedUserId).not.toBe(OTHER_USER);
    expect(forkedUserId).not.toBe(SIGNER_OWNER);

    expect(result.createdUser).toBe(true);
    expect(result.createdWallet).toBe(true);
  });
});
