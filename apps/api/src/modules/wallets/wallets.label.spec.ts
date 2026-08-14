// apps/api/src/modules/wallets/wallets.label.spec.ts
//
// W2 — PATCH /v1/wallets/:id label rename. Ownership + honest-clear semantics:
//   * the ownership gate (getWalletOrThrow) and the UPDATE itself are BOTH
//     scoped by id AND user_id — a non-owner gets 404, never a write;
//   * blank label clears to null (short-address fallback), it is never stored
//     as an empty string.

import { NotFoundException } from '@nestjs/common';
import { WalletsService } from './wallets.service';

const OWNER = '00000000-0000-4000-8000-0000000000aa';
const NON_OWNER = '00000000-0000-4000-8000-0000000000bb';
const WALLET_ID = '11111111-1111-4111-8111-111111111111';

function walletRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: WALLET_ID,
    user_id: OWNER,
    chain: 'stellar',
    address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWALLET',
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

function makeService(rowsForSelect: unknown[]) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const handler = async (sql: string, ...args: unknown[]) => {
    calls.push({ sql, args });
    if (sql.includes('update user_wallets')) {
      return [walletRow({ label: args[2] ?? null })];
    }
    return rowsForSelect;
  };
  const prisma = {
    $queryRawUnsafe: jest.fn(handler),
    $executeRawUnsafe: jest.fn(handler),
  } as never;
  return { service: new WalletsService(prisma), calls };
}

describe('updateWalletLabel — ownership + clear semantics', () => {
  it('renames: UPDATE scoped by id AND user_id, label persisted', async () => {
    const { service, calls } = makeService([walletRow()]);

    const result = await service.updateWalletLabel({
      userId: OWNER,
      walletId: WALLET_ID,
      label: 'Trading',
    });

    const update = calls.find((c) => c.sql.includes('update user_wallets'));
    expect(update).toBeDefined();
    expect(update!.sql).toContain('id = $1::uuid');
    expect(update!.sql).toContain('user_id = $2::uuid');
    expect(update!.args).toEqual([WALLET_ID, OWNER, 'Trading']);
    // Label-only: the SET clause touches nothing but label + updated_at
    // (RETURNING legitimately lists every column, so scope to SET…WHERE).
    const setClause = update!.sql.slice(
      update!.sql.indexOf('set'),
      update!.sql.indexOf('where')
    );
    expect(setClause).toContain('label = $3');
    expect(setClause).not.toContain('is_active_signer');
    expect(setClause).not.toContain('is_primary');
    expect(setClause).not.toContain('is_active =');

    expect(result.updated).toBe(true);
    expect(result.wallet.label).toBe('Trading');
  });

  it('blank label clears to null (short-address fallback), never ""', async () => {
    const { service, calls } = makeService([walletRow()]);

    const result = await service.updateWalletLabel({
      userId: OWNER,
      walletId: WALLET_ID,
      label: '   ',
    });

    const update = calls.find((c) => c.sql.includes('update user_wallets'));
    expect(update!.args[2]).toBeNull();
    expect(result.wallet.label).toBeNull();
  });

  it("non-owner → 404 before any write (ownership gate)", async () => {
    const { service, calls } = makeService([]); // scoped select finds nothing

    await expect(
      service.updateWalletLabel({
        userId: NON_OWNER,
        walletId: WALLET_ID,
        label: 'Mine now',
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(
      calls.find((c) => c.sql.includes('update user_wallets'))
    ).toBeUndefined();
  });
});
