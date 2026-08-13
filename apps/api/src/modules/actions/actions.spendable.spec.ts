import { BadRequestException } from '@nestjs/common';
import { Account, Keypair } from '@stellar/stellar-sdk';
import {
  ActionsService,
  computeSpendable,
  type SpendableAccountView,
} from './actions.service';
import { ActionsController } from './actions.controller';

/**
 * F2 — spendable-balance preflight. Covers the pure computation (reserves,
 * subentries, selling liabilities, non-native) and the controller 400 path that
 * stops an underfunded swap (the real failed tx a3acf8fa…) before signing.
 */
describe('computeSpendable (F2)', () => {
  const native = (
    balance: string,
    selling = '0',
    subentries = 0,
  ): SpendableAccountView => ({
    subentryCount: subentries,
    balances: [{ asset_type: 'native', balance, selling_liabilities: selling }],
  });

  it('subtracts base + subentry reserves and the fee buffer for native XLM', () => {
    // 5 XLM, no subentries → minBalance = (2+0)*0.5 = 1; spendable = 5 - 1 - 0 - 0.01
    expect(computeSpendable(native('5'), { isNative: true })).toBeCloseTo(3.99, 7);
    // 3 subentries → minBalance = (2+3)*0.5 = 2.5; spendable = 10 - 2.5 - 0.01
    expect(computeSpendable(native('10', '0', 3), { isNative: true })).toBeCloseTo(
      7.49,
      7,
    );
  });

  it('subtracts selling liabilities for native XLM', () => {
    // 10 XLM, 4 locked as selling liabilities, no subentries → 10 - 1 - 4 - 0.01
    expect(computeSpendable(native('10', '4'), { isNative: true })).toBeCloseTo(
      4.99,
      7,
    );
  });

  it('clamps to 0 when reserves exceed the balance (the underfunded case)', () => {
    // 1 XLM but 2 base reserves required → negative, clamped to 0
    expect(computeSpendable(native('1'), { isNative: true })).toBe(0);
  });

  it('returns 0 when the account holds no native balance line', () => {
    expect(
      computeSpendable({ subentryCount: 0, balances: [] }, { isNative: true }),
    ).toBe(0);
  });

  it('subtracts only selling liabilities for a non-native asset (no reserve)', () => {
    const view: SpendableAccountView = {
      subentryCount: 5,
      balances: [
        {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          balance: '250.5',
          selling_liabilities: '50.5',
        },
      ],
    };
    expect(
      computeSpendable(view, {
        isNative: false,
        code: 'USDC',
        issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      }),
    ).toBeCloseTo(200, 7);
  });

  it('returns 0 for a non-native asset with no matching trustline', () => {
    expect(
      computeSpendable(native('100'), {
        isNative: false,
        code: 'USDC',
        issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      }),
    ).toBe(0);
  });
});

describe('ActionsController — swap spendable 400 path (F2)', () => {
  const address = Keypair.random().publicKey();

  function wire(view: SpendableAccountView | null) {
    const service = new ActionsService();
    // Stub the two network seams so no RPC/Horizon call leaves the test.
    jest
      .spyOn(service as unknown as { rpcFor: () => unknown }, 'rpcFor')
      .mockReturnValue({
        getAccount: async () => new Account(address, '100'),
      });
    jest
      .spyOn(
        service as unknown as { loadHorizonAccount: () => unknown },
        'loadHorizonAccount',
      )
      .mockResolvedValue(
        view && {
          subentry_count: view.subentryCount,
          balances: view.balances,
        },
      );
    // E3: the controller records adoption events via OpsService — stubbed out
    // here (fire-and-forget; irrelevant to the spendable 400 path under test).
    const opsStub = {
      recordActionEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as ConstructorParameters<typeof ActionsController>[1];
    return new ActionsController(service, opsStub);
  }

  it('rejects a swap sending more than spendable with a clean 400', async () => {
    // 5.5 XLM, 2 subentries → spendable ≈ 3.49; sending 100 must 400.
    const controller = wire({
      subentryCount: 2,
      balances: [
        { asset_type: 'native', balance: '5.5', selling_liabilities: '0' },
      ],
    });

    let thrown: unknown;
    try {
      await controller.sdexSwap({
        address,
        fromAsset: 'XLM',
        toAsset: 'USDC',
        amount: '100',
        minReceive: '1',
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getResponse()).toMatchObject({
      code: 'INSUFFICIENT_SPENDABLE_BALANCE',
      asset: 'XLM',
      requested: '100',
      spendable: expect.any(String),
    });
  });

  it('passes preflight and builds an XDR when the balance is sufficient', async () => {
    // 500 XLM funds the 100 XLM send comfortably.
    const controller = wire({
      subentryCount: 0,
      balances: [
        { asset_type: 'native', balance: '500', selling_liabilities: '0' },
      ],
    });

    const result = await controller.sdexSwap({
      address,
      fromAsset: 'XLM',
      toAsset: 'USDC',
      amount: '100',
      minReceive: '1',
    });

    expect(typeof result.xdr).toBe('string');
    expect(result.xdr.length).toBeGreaterThan(0);
  });
});
