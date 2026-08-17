// R2 (Lot R — T3-D2): pins the EXACT payout transaction shape. The payout
// service can only express this one transaction — any drift (extra op,
// different asset, missing memo) is a money-path defect this spec catches.
import { Account, Keypair, Networks, Operation } from '@stellar/stellar-sdk';
import {
  buildSignedPayout,
  PAYOUT_MEMO,
  PAYOUT_FEE_STROOPS,
  PayoutError,
} from './faucet-payout.service';

describe('buildSignedPayout', () => {
  const keypair = Keypair.random();
  const destination = Keypair.random().publicKey();

  const build = () =>
    buildSignedPayout({
      source: new Account(keypair.publicKey(), '41'),
      keypair,
      destination,
      amountXlm: '5.0000000',
      networkPassphrase: Networks.TESTNET,
    });

  it('is exactly ONE native payment of the reward to the claiming wallet', () => {
    const tx = build();
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as Operation.Payment;
    expect(op.type).toBe('payment');
    expect(op.destination).toBe(destination);
    expect(op.asset.isNative()).toBe(true);
    expect(op.amount).toBe('5.0000000');
  });

  it(`carries the '${PAYOUT_MEMO}' memo, the fixed fee, a timebound, and the treasury signature`, () => {
    const tx = build();
    expect(tx.memo.type).toBe('text');
    expect(tx.memo.value?.toString()).toBe(PAYOUT_MEMO);
    expect(tx.fee).toBe(PAYOUT_FEE_STROOPS);
    expect(Number(tx.timeBounds?.maxTime)).toBeGreaterThan(0);
    expect(tx.signatures).toHaveLength(1);
    // The signature verifies against the TREASURY key over this exact tx hash.
    expect(keypair.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
  });

  it('increments the loaded sequence number (serial payouts by design)', () => {
    expect(build().sequence).toBe('42');
  });
});

describe('PayoutError', () => {
  it('carries maybePaid so an ambiguous submit is never treated as definitely unpaid', () => {
    const ambiguous = new PayoutError('submit-ambiguous (status none)', true);
    expect(ambiguous.maybePaid).toBe(true);
    const rejected = new PayoutError('horizon-rejected: {"transaction":"tx_failed"}', false);
    expect(rejected.maybePaid).toBe(false);
  });
});
