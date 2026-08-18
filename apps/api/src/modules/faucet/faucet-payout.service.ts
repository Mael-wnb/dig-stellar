// apps/api/src/modules/faucet/faucet-payout.service.ts
//
// R2 (Lot R — T3-D2): treasury payout. **THIS IS THE ONLY FILE IN apps/api
// PERMITTED TO READ FAUCET_SECRET_KEY OR INVOKE Keypair SIGNING** — the sole,
// explicitly-scoped exception to INV-1.2 (see docs/security-invariants.md §9).
// The key signs payments FROM DIG'S OWN hot wallet (funded manually, 200 XLM
// hard cap = the maximum possible exposure) — never anything of a user's.
//
// Hard rules enforced here:
//   - The secret is read lazily per payout, never cached, never logged, never
//     part of any error message or thrown object.
//   - One payout = ONE classic payment op (5 XLM, memo 'dig-reward') — this
//     service cannot express any other transaction shape.
//   - No retries at this layer, ever: an ambiguous submit (timeout / 5xx) may
//     STILL HAVE PAID, so the error carries `maybePaid` and the caller records
//     a blocking `failed` row for founder review instead of resubmitting.

import { Injectable } from '@nestjs/common';
import {
  Account,
  Asset,
  Horizon,
  Keypair,
  Memo,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  faucetHorizonUrl,
  faucetNetworkPassphrase,
  type FaucetNetwork,
} from './faucet-config';

export const PAYOUT_MEMO = 'dig-reward';
/** Matches the actions default inclusion fee — generous for a classic payment. */
export const PAYOUT_FEE_STROOPS = '10000';
const PAYOUT_TIMEOUT_SECONDS = 60;

/**
 * Spendable = native balance − this buffer: 1 XLM base reserve (the hot wallet
 * is a fresh keypair with zero subentries) + 0.5 XLM fee headroom.
 */
export const TREASURY_RESERVE_BUFFER_XLM = 1.5;

/** How long a fetched treasury balance may serve eligibility reads. */
const TREASURY_CACHE_MS = 30_000;

export class PayoutError extends Error {
  /** True when the tx MAY have reached the network (timeout / ambiguous 5xx). */
  readonly maybePaid: boolean;
  /** Short machine-ish reason stored on the failed claim row. Never key material. */
  readonly reason: string;
  constructor(reason: string, maybePaid: boolean) {
    super(reason);
    this.reason = reason;
    this.maybePaid = maybePaid;
  }
}

/**
 * Builds and signs the payout tx — PURE given a sequence-loaded source
 * account, so the specs can pin the exact transaction shape: one native
 * payment, fixed memo, fixed fee, 60s timebound.
 */
export function buildSignedPayout(params: {
  source: Account;
  keypair: Keypair;
  destination: string;
  amountXlm: string;
  networkPassphrase: string;
}): Transaction {
  const tx = new TransactionBuilder(params.source, {
    fee: PAYOUT_FEE_STROOPS,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: params.destination,
        asset: Asset.native(),
        amount: params.amountXlm,
      }),
    )
    .addMemo(Memo.text(PAYOUT_MEMO))
    .setTimeout(PAYOUT_TIMEOUT_SECONDS)
    .build();
  tx.sign(params.keypair);
  return tx;
}

@Injectable()
export class FaucetPayoutService {
  private readonly horizonServers = new Map<FaucetNetwork, Horizon.Server>();
  // Not network-keyed — FAUCET_NETWORK is a single active network per process
  // (ratified at R2 review); pay() invalidates it on every payout.
  private treasuryCache: { at: number; value: number | null } | null = null;

  private horizonFor(network: FaucetNetwork): Horizon.Server {
    const cached = this.horizonServers.get(network);
    if (cached) return cached;
    const server = new Horizon.Server(faucetHorizonUrl(network));
    this.horizonServers.set(network, server);
    return server;
  }

  /** The keypair, or null when the env is missing/unparseable. Never throws. */
  private treasuryKeypair(): Keypair | null {
    const secret = process.env.FAUCET_SECRET_KEY?.trim();
    if (!secret) return null;
    try {
      return Keypair.fromSecret(secret);
    } catch {
      return null;
    }
  }

  /** True iff a payout could be signed. Exposes NOTHING about the key itself. */
  keyAvailable(): boolean {
    return this.treasuryKeypair() !== null;
  }

  /**
   * Treasury SPENDABLE XLM (native − reserve/fee buffer), cached 30s so
   * eligibility polls don't hammer Horizon. Returns null when the key is
   * unavailable or Horizon cannot answer — callers treat null as NOT payable.
   */
  async treasurySpendableXlm(network: FaucetNetwork): Promise<number | null> {
    const now = Date.now();
    if (this.treasuryCache && now - this.treasuryCache.at < TREASURY_CACHE_MS) {
      return this.treasuryCache.value;
    }
    const value = await this.fetchTreasurySpendable(network);
    this.treasuryCache = { at: now, value };
    return value;
  }

  private async fetchTreasurySpendable(network: FaucetNetwork): Promise<number | null> {
    const keypair = this.treasuryKeypair();
    if (!keypair) return null;
    try {
      const account = await this.horizonFor(network).loadAccount(keypair.publicKey());
      const native = account.balances.find((b) => b.asset_type === 'native');
      if (!native) return null;
      return Math.max(0, parseFloat(native.balance) - TREASURY_RESERVE_BUFFER_XLM);
    } catch {
      return null; // unfunded / unreachable — never payable on a guess
    }
  }

  /**
   * Executes ONE payout. The caller (FaucetService) serializes invocations —
   * the hot wallet's sequence number would make parallel submits fail anyway,
   * so the design assumes serial, it does not discover it.
   */
  async pay(params: {
    network: FaucetNetwork;
    destination: string;
    amountXlm: string;
  }): Promise<{ payoutTxHash: string }> {
    const keypair = this.treasuryKeypair();
    if (!keypair) throw new PayoutError('treasury-key-unavailable', false);

    const horizon = this.horizonFor(params.network);
    let source: Account;
    try {
      const loaded = await horizon.loadAccount(keypair.publicKey());
      source = new Account(keypair.publicKey(), loaded.sequenceNumber());
    } catch {
      // Nothing was submitted — loading the source account failed.
      throw new PayoutError('treasury-account-unavailable', false);
    }

    const tx = buildSignedPayout({
      source,
      keypair,
      destination: params.destination,
      amountXlm: params.amountXlm,
      networkPassphrase: faucetNetworkPassphrase(params.network),
    });

    try {
      const result = await horizon.submitTransaction(tx);
      this.treasuryCache = null; // balance changed — next read is fresh
      return { payoutTxHash: result.hash };
    } catch (err) {
      throw toPayoutError(err);
    }
  }
}

/**
 * Maps a Horizon submit failure to a PayoutError. Only a definitive 400 with
 * result codes proves NON-inclusion; anything else (timeout, 5xx, network
 * error) is conservatively `maybePaid` — the founder verifies on the explorer
 * before resolving the failed claim.
 */
function toPayoutError(err: unknown): PayoutError {
  const e = err as {
    response?: {
      status?: number;
      data?: { extras?: { result_codes?: unknown } };
    };
  } | null;
  const status = e?.response?.status;
  if (status === 400) {
    const codes = e?.response?.data?.extras?.result_codes;
    const detail = codes ? JSON.stringify(codes).slice(0, 200) : 'tx_rejected';
    return new PayoutError(`horizon-rejected: ${detail}`, false);
  }
  return new PayoutError(
    `submit-ambiguous (status ${status ?? 'none'}): MAY have paid, verify payout on explorer before resolving`,
    true,
  );
}
