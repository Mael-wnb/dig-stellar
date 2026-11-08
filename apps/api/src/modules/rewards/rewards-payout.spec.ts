// Lot EP (EP5): pins the EXACT rewards payout transaction shape (one native
// payment, memo 'dig-points', fixed fee, timebound, treasury signature) and
// drives pay() / treasuryBalanceXlm() against a FAKE Horizon — this spec never
// touches a network. The secret used here is a throwaway Keypair.random()
// generated in-process; it is never a real treasury key.
import { Account, Keypair, Networks, Operation, type Transaction } from '@stellar/stellar-sdk';
import {
  buildSignedRewardsPayout,
  PAYOUT_FEE_STROOPS,
  RewardsPayoutError,
  RewardsPayoutService,
  type HorizonLike,
} from './rewards-payout.service';
import { REWARDS_PAYOUT_MEMO } from './rewards-config';

describe('buildSignedRewardsPayout', () => {
  const keypair = Keypair.random();
  const destination = Keypair.random().publicKey();

  const build = () =>
    buildSignedRewardsPayout({
      source: new Account(keypair.publicKey(), '41'),
      keypair,
      destination,
      amountXlm: '3.5000000',
      networkPassphrase: Networks.TESTNET,
    });

  it('is exactly ONE native payment of the claim total to the claiming wallet', () => {
    const tx = build();
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as Operation.Payment;
    expect(op.type).toBe('payment');
    expect(op.destination).toBe(destination);
    expect(op.asset.isNative()).toBe(true);
    expect(op.amount).toBe('3.5000000');
  });

  it(`carries the '${REWARDS_PAYOUT_MEMO}' memo (never the faucet's), the fixed fee, a timebound, and the treasury signature`, () => {
    const tx = build();
    expect(REWARDS_PAYOUT_MEMO).toBe('dig-points');
    expect(tx.memo.type).toBe('text');
    expect(tx.memo.value?.toString()).toBe('dig-points');
    expect(tx.fee).toBe(PAYOUT_FEE_STROOPS);
    expect(Number(tx.timeBounds?.maxTime)).toBeGreaterThan(0);
    expect(tx.signatures).toHaveLength(1);
    expect(keypair.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
  });

  it('increments the loaded sequence number (serial payouts by design)', () => {
    expect(build().sequence).toBe('42');
  });
});

/** A Horizon stand-in: scripted balance / sequence / submit outcome, records what it saw. */
class FakeHorizon implements HorizonLike {
  loaded: string[] = [];
  submitted: Transaction[] = [];
  balance: string | null = '300.0000000';
  sequence = '7';
  loadFails = false;
  submitOutcome: { hash: string } | { throw: unknown } = { hash: 'f'.repeat(64) };

  async loadAccount(accountId: string) {
    this.loaded.push(accountId);
    if (this.loadFails) throw new Error('404');
    return {
      sequenceNumber: () => this.sequence,
      balances: this.balance == null ? [] : [{ asset_type: 'native', balance: this.balance }],
    };
  }

  async submitTransaction(tx: Transaction) {
    this.submitted.push(tx);
    if ('throw' in this.submitOutcome) throw this.submitOutcome.throw;
    return { hash: this.submitOutcome.hash };
  }
}

class TestablePayout extends RewardsPayoutService {
  readonly fake = new FakeHorizon();
  urls: string[] = [];
  protected override createHorizon(url: string): HorizonLike {
    this.urls.push(url);
    return this.fake;
  }
}

describe('RewardsPayoutService (fake Horizon, throwaway key)', () => {
  const treasury = Keypair.random();
  const wallet = Keypair.random().publicKey();
  const claimId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    process.env.REWARDS_SECRET_KEY = treasury.secret();
  });
  afterEach(() => {
    delete process.env.REWARDS_SECRET_KEY;
  });

  it('keyAvailable: true with a parseable secret, false when unset or garbage — and says nothing else', () => {
    const svc = new TestablePayout();
    expect(svc.keyAvailable()).toBe(true);
    process.env.REWARDS_SECRET_KEY = 'not-a-secret';
    expect(svc.keyAvailable()).toBe(false);
    delete process.env.REWARDS_SECRET_KEY;
    expect(svc.keyAvailable()).toBe(false);
  });

  it('treasuryBalanceXlm: native balance as a number, read from the KEY\'s own account on the network\'s Horizon; null without a key, without native balance, or on error', async () => {
    const svc = new TestablePayout();
    expect(await svc.treasuryBalanceXlm('testnet')).toBe(300);
    expect(svc.urls).toEqual(['https://horizon-testnet.stellar.org']);
    expect(svc.fake.loaded).toEqual([treasury.publicKey()]);

    const fresh = new TestablePayout();
    fresh.fake.balance = null;
    expect(await fresh.treasuryBalanceXlm('testnet')).toBeNull();

    const failing = new TestablePayout();
    failing.fake.loadFails = true;
    expect(await failing.treasuryBalanceXlm('mainnet')).toBeNull();
    expect(failing.urls).toEqual(['https://horizon.stellar.org']);

    delete process.env.REWARDS_SECRET_KEY;
    const noKey = new TestablePayout();
    expect(await noKey.treasuryBalanceXlm('testnet')).toBeNull();
    expect(noKey.fake.loaded).toEqual([]); // no key → Horizon never asked
  });

  it('pay: loads the treasury sequence, submits ONE payment of the claim total with the dig-points memo, returns the hash', async () => {
    const svc = new TestablePayout();
    const out = await svc.pay({ network: 'testnet', destination: wallet, amountXlm: '3.5000000', claimId });
    expect(out).toEqual({ txHash: 'f'.repeat(64) });
    expect(svc.fake.submitted).toHaveLength(1);
    const tx = svc.fake.submitted[0];
    expect(tx.sequence).toBe('8');
    expect(tx.operations).toHaveLength(1);
    expect((tx.operations[0] as Operation.Payment).amount).toBe('3.5000000');
    expect((tx.operations[0] as Operation.Payment).destination).toBe(wallet);
    expect(tx.memo.value?.toString()).toBe('dig-points');
    expect(treasury.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
    expect(tx.networkPassphrase).toBe(Networks.TESTNET);
  });

  it('pay refuses without a claim id and without a key — before anything reaches Horizon', async () => {
    const svc = new TestablePayout();
    await expect(svc.pay({ network: 'testnet', destination: wallet, amountXlm: '1.0000000', claimId: '' })).rejects.toMatchObject({ reason: 'claim-id-required', maybePaid: false });
    delete process.env.REWARDS_SECRET_KEY;
    await expect(svc.pay({ network: 'testnet', destination: wallet, amountXlm: '1.0000000', claimId })).rejects.toMatchObject({ reason: 'treasury-key-unavailable', maybePaid: false });
    expect(svc.fake.submitted).toEqual([]);
    expect(svc.fake.loaded).toEqual([]);
  });

  it('pay: a failed account load is a definite non-payment; a 400 with result codes is definite; anything else is maybePaid', async () => {
    const unloadable = new TestablePayout();
    unloadable.fake.loadFails = true;
    await expect(unloadable.pay({ network: 'testnet', destination: wallet, amountXlm: '1.0000000', claimId })).rejects.toMatchObject({ reason: 'treasury-account-unavailable', maybePaid: false });

    const rejected = new TestablePayout();
    rejected.fake.submitOutcome = { throw: { response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_insufficient_balance' } } } } } };
    await expect(rejected.pay({ network: 'testnet', destination: wallet, amountXlm: '1.0000000', claimId })).rejects.toMatchObject({
      reason: 'horizon-rejected: {"transaction":"tx_insufficient_balance"}',
      maybePaid: false,
    });

    const timeout = new TestablePayout();
    timeout.fake.submitOutcome = { throw: { response: { status: 504 } } };
    const err = await timeout.pay({ network: 'testnet', destination: wallet, amountXlm: '1.0000000', claimId }).catch((e) => e as RewardsPayoutError);
    expect(err).toBeInstanceOf(RewardsPayoutError);
    expect((err as RewardsPayoutError).maybePaid).toBe(true);
    expect((err as RewardsPayoutError).reason).toContain('submit-ambiguous (status 504)');

    const network = new TestablePayout();
    network.fake.submitOutcome = { throw: new Error('ECONNRESET') };
    await expect(network.pay({ network: 'testnet', destination: wallet, amountXlm: '1.0000000', claimId })).rejects.toMatchObject({ maybePaid: true });
  });

  it('never leaks the secret: no error message, reason or payload contains it', async () => {
    const svc = new TestablePayout();
    svc.fake.submitOutcome = { throw: new Error(`boom ${treasury.secret()}`) };
    const err = await svc.pay({ network: 'testnet', destination: wallet, amountXlm: '1.0000000', claimId }).catch((e) => e as RewardsPayoutError);
    expect(JSON.stringify({ message: err.message, reason: err.reason })).not.toContain(treasury.secret());
  });
});
