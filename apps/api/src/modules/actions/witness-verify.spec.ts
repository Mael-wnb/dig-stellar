// R1 (Lot R — T3-D2): unit specs for the PURE witness qualification rules.
// These rules decide faucet eligibility (a money path from R2 on), so the
// what-counts-as-a-qualifying-action logic is pinned here in isolation.
import { Networks } from '@stellar/stellar-sdk';
import {
  findQualifyingOp,
  computeNotionalXlm,
  contractIdFor,
  type HorizonOpRecordLike,
} from './witness-verify';

const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const OTHER = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBC4W';
const POOL = 'CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const swapOp = (over: Partial<HorizonOpRecordLike> = {}): HorizonOpRecordLike => ({
  type: 'path_payment_strict_send',
  source_account: WALLET,
  source_asset_type: 'native',
  source_amount: '12.5000000',
  asset_type: 'credit_alphanum4',
  asset_code: 'USDC',
  asset_issuer: USDC_ISSUER,
  amount: '4.1000000',
  ...over,
});

describe('findQualifyingOp', () => {
  it('qualifies a path_payment_strict_send from the wallet as sdex-swap, source leg first', () => {
    const q = findQualifyingOp([swapOp()], WALLET, [POOL]);
    expect(q).not.toBeNull();
    expect(q!.kind).toBe('sdex-swap');
    expect(q!.legs[0]).toEqual({
      label: 'source',
      asset: { native: true },
      amount: 12.5,
    });
    expect(q!.legs[1].label).toBe('dest');
  });

  it('rejects a qualifying-shaped op whose source is NOT the witnessed wallet', () => {
    expect(findQualifyingOp([swapOp({ source_account: OTHER })], WALLET, [POOL])).toBeNull();
  });

  it('qualifies a manage_buy_offer (per brief) on its buying leg', () => {
    const q = findQualifyingOp(
      [
        {
          type: 'manage_buy_offer',
          source_account: WALLET,
          amount: '7.0000000',
          buying_asset_type: 'credit_alphanum4',
          buying_asset_code: 'USDC',
          buying_asset_issuer: USDC_ISSUER,
        },
      ],
      WALLET,
      [POOL],
    );
    expect(q?.kind).toBe('sdex-swap');
    expect(q?.legs).toEqual([
      { label: 'buying', asset: { native: false, code: 'USDC', issuer: USDC_ISSUER }, amount: 7 },
    ]);
  });

  it('qualifies an invoke moving funds wallet → registry pool as blend-deposit', () => {
    const q = findQualifyingOp(
      [
        {
          type: 'invoke_host_function',
          source_account: WALLET,
          asset_balance_changes: [
            { type: 'transfer', asset_type: 'native', from: WALLET, to: POOL, amount: '25.0000000' },
          ],
        },
      ],
      WALLET,
      [POOL],
    );
    expect(q?.kind).toBe('blend-deposit');
    expect(q?.legs).toEqual([{ label: 'deposit', asset: { native: true }, amount: 25 }]);
    expect(q?.summary.pool).toBe(POOL);
  });

  it('qualifies a withdraw-shaped invoke (pool → wallet) as blend-withdraw (KPI ledger, amendment 2026-08-17)', () => {
    const q = findQualifyingOp(
      [
        {
          type: 'invoke_host_function',
          source_account: WALLET,
          asset_balance_changes: [
            { type: 'transfer', asset_type: 'native', from: POOL, to: WALLET, amount: '25.0000000' },
          ],
        },
      ],
      WALLET,
      [POOL],
    );
    expect(q?.kind).toBe('blend-withdraw');
    expect(q?.legs).toEqual([{ label: 'withdraw', asset: { native: true }, amount: 25 }]);
    expect(q?.summary.pool).toBe(POOL);
  });

  it('rejects invoke transfers involving unknown contracts (neither direction matches a registry pool)', () => {
    const unknownPool: HorizonOpRecordLike = {
      type: 'invoke_host_function',
      source_account: WALLET,
      asset_balance_changes: [
        { type: 'transfer', asset_type: 'native', from: WALLET, to: OTHER, amount: '25.0000000' },
      ],
    };
    expect(findQualifyingOp([unknownPool], WALLET, [POOL])).toBeNull();
  });

  it('rejects non-qualifying op types (payment, change_trust)', () => {
    expect(
      findQualifyingOp(
        [
          { type: 'payment', source_account: WALLET, amount: '5.0000000', asset_type: 'native' },
          { type: 'change_trust', source_account: WALLET },
        ],
        WALLET,
        [POOL],
      ),
    ).toBeNull();
  });
});

describe('computeNotionalXlm', () => {
  const PASS = Networks.PUBLIC;
  const XLM_SAC = contractIdFor({ native: true }, PASS)!;
  const USDC_SAC = contractIdFor({ native: false, code: 'USDC', issuer: USDC_ISSUER }, PASS)!;

  it('prices a native leg directly, no price data needed', () => {
    const r = computeNotionalXlm([{ label: 'source', asset: { native: true }, amount: 12.5 }], new Map(), PASS);
    expect(r.notionalXlm).toBe(12.5);
    expect(r.pricing.method).toBe('native-direct');
  });

  it('crosses a non-native leg through USD (amount * assetUsd / xlmUsd)', () => {
    const prices = new Map([
      [XLM_SAC, 0.155],
      [USDC_SAC, 1.0],
    ]);
    const r = computeNotionalXlm(
      [{ label: 'buying', asset: { native: false, code: 'USDC', issuer: USDC_ISSUER }, amount: 3.1 }],
      prices,
      PASS,
    );
    expect(r.notionalXlm).toBeCloseTo(20.0, 5);
    expect(r.pricing.method).toBe('usd-cross');
  });

  it('falls back to the dest leg when the source leg is unpriceable', () => {
    const prices = new Map([
      [XLM_SAC, 0.155],
      [USDC_SAC, 1.0],
    ]);
    const r = computeNotionalXlm(
      [
        { label: 'source', asset: { native: false, code: 'ZZZ', issuer: USDC_ISSUER }, amount: 100 },
        { label: 'dest', asset: { native: false, code: 'USDC', issuer: USDC_ISSUER }, amount: 1.55 },
      ],
      prices,
      PASS,
    );
    expect(r.notionalXlm).toBeCloseTo(10.0, 5);
    expect(r.pricing.pricedLeg).toBe('dest');
  });

  it('returns NULL (honest) when no leg can be priced — incl. a missing XLM price', () => {
    const noXlm = new Map([[USDC_SAC, 1.0]]);
    const r = computeNotionalXlm(
      [{ label: 'buying', asset: { native: false, code: 'USDC', issuer: USDC_ISSUER }, amount: 3.1 }],
      noXlm,
      PASS,
    );
    expect(r.notionalXlm).toBeNull();
    expect(r.pricing.method).toBe('unpriceable');
  });
});
