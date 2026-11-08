// apps/api/src/modules/rewards/rewards-payout.service.ts
//
// Lot EP (EP5): the rewards treasury payout. **THIS IS THE ONLY FILE IN apps/api
// PERMITTED TO READ REWARDS_SECRET_KEY OR TO SIGN WITH THE REWARDS TREASURY
// KEY** — the second explicitly-scoped exception to INV-1.2, next to the faucet
// (docs/security-invariants.md §13, INV-13.1). Copied from
// modules/faucet/faucet-payout.service.ts on purpose and NEVER imported from
// it: the two money paths share no code, so a change to one cannot widen the
// other. The key signs payments FROM DIG'S OWN rewards treasury, funded with a
// few days of pool and no more — never anything of a user's.
//
// Hard rules enforced here:
//   - The secret is read lazily per call, never cached, never logged, never
//     part of any error message, thrown object or payload.
//   - One payout = ONE classic native payment for ONE claim (memo 'dig-points')
//     — this service cannot express any other transaction shape (INV-13.2),
//     and pay() REQUIRES the claim id it pays for (review grep: no send
//     without a claim id).
//   - No retries at this layer, ever: an ambiguous submit (timeout / 5xx) may
//     STILL HAVE PAID, so the error carries `maybePaid` and the caller records
//     a 'failed' claim for founder review instead of resubmitting.
//   - Horizon is reached through createHorizon(), overridable by the spec with a
//     fake — the spec never touches a network.

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
  REWARDS_PAYOUT_MEMO,
  rewardsHorizonUrl,
  rewardsNetworkPassphrase,
  type RewardsNetwork,
} from './rewards-config';

/** Generous for a classic payment; same figure as the actions default inclusion fee. */
export const PAYOUT_FEE_STROOPS = '10000';
const PAYOUT_TIMEOUT_SECONDS = 60;

/** How long a fetched treasury balance may serve reads (the claim re-reads it anyway). */
const TREASURY_CACHE_MS = 30_000;

/** The slice of Horizon.Server this service uses (the spec provides a fake). */
export interface HorizonLike {
  loadAccount(accountId: string): Promise<{ sequenceNumber(): string; balances: Array<{ asset_type: string; balance: string }> }>;
  submitTransaction(tx: Transaction): Promise<{ hash: string }>;
}

export class RewardsPayoutError extends Error {
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
 * account, so the spec can pin the exact transaction shape: one native
 * payment, fixed memo, fixed fee, 60 s timebound.
 */
export function buildSignedRewardsPayout(params: {
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
    .addMemo(Memo.text(REWARDS_PAYOUT_MEMO))
    .setTimeout(PAYOUT_TIMEOUT_SECONDS)
    .build();
  tx.sign(params.keypair);
  return tx;
}

@Injectable()
export class RewardsPayoutService {
  private readonly horizonServers = new Map<RewardsNetwork, HorizonLike>();
  private treasuryCache: { at: number; value: number | null } | null = null;

  /** Overridden by the spec with a fake; production builds a Horizon.Server. */
  protected createHorizon(url: string): HorizonLike {
    return new Horizon.Server(url) as unknown as HorizonLike;
  }

  private horizonFor(network: RewardsNetwork): HorizonLike {
    const cached = this.horizonServers.get(network);
    if (cached) return cached;
    const server = this.createHorizon(rewardsHorizonUrl(network));
    this.horizonServers.set(network, server);
    return server;
  }

  /** The keypair, or null when the env is missing/unparseable. Never throws, never logs. */
  private treasuryKeypair(): Keypair | null {
    const secret = process.env.REWARDS_SECRET_KEY?.trim();
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
   * Treasury NATIVE balance in XLM (the claim rule applies the 2 XLM reserve
   * itself), cached 30 s. Null when the key is unavailable or Horizon cannot
   * answer — callers treat null as NOT payable.
   */
  async treasuryBalanceXlm(network: RewardsNetwork): Promise<number | null> {
    const now = Date.now();
    if (this.treasuryCache && now - this.treasuryCache.at < TREASURY_CACHE_MS) {
      return this.treasuryCache.value;
    }
    const value = await this.fetchTreasuryBalance(network);
    this.treasuryCache = { at: now, value };
    return value;
  }

  private async fetchTreasuryBalance(network: RewardsNetwork): Promise<number | null> {
    const keypair = this.treasuryKeypair();
    if (!keypair) return null;
    try {
      const account = await this.horizonFor(network).loadAccount(keypair.publicKey());
      const native = account.balances.find((b) => b.asset_type === 'native');
      if (!native) return null;
      const parsed = parseFloat(native.balance);
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null; // unfunded / unreachable — never payable on a guess
    }
  }

  /**
   * Executes ONE payout for ONE claim. The caller (RewardsService) serializes
   * invocations — the treasury's sequence number would make parallel submits
   * fail anyway, so the design assumes serial, it does not discover it.
   */
  async pay(params: {
    network: RewardsNetwork;
    destination: string;
    /** 7-decimal string (stroopsToXlm). */
    amountXlm: string;
    /** The reward_claims.id this payment settles — REQUIRED (INV-13.2). */
    claimId: string;
  }): Promise<{ txHash: string }> {
    if (!params.claimId) throw new RewardsPayoutError('claim-id-required', false);
    const keypair = this.treasuryKeypair();
    if (!keypair) throw new RewardsPayoutError('treasury-key-unavailable', false);

    const horizon = this.horizonFor(params.network);
    let source: Account;
    try {
      const loaded = await horizon.loadAccount(keypair.publicKey());
      source = new Account(keypair.publicKey(), loaded.sequenceNumber());
    } catch {
      // Nothing was submitted — loading the source account failed.
      throw new RewardsPayoutError('treasury-account-unavailable', false);
    }

    const tx = buildSignedRewardsPayout({
      source,
      keypair,
      destination: params.destination,
      amountXlm: params.amountXlm,
      networkPassphrase: rewardsNetworkPassphrase(params.network),
    });

    try {
      const result = await horizon.submitTransaction(tx);
      this.treasuryCache = null; // balance changed — next read is fresh
      return { txHash: result.hash };
    } catch (err) {
      throw toPayoutError(err);
    }
  }
}

/**
 * Maps a Horizon submit failure to a RewardsPayoutError. Only a definitive 400
 * with result codes proves NON-inclusion; anything else (timeout, 5xx, network
 * error) is conservatively `maybePaid` — the founder verifies on the explorer
 * before resolving the failed claim.
 */
function toPayoutError(err: unknown): RewardsPayoutError {
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
    return new RewardsPayoutError(`horizon-rejected: ${detail}`, false);
  }
  return new RewardsPayoutError(
    `submit-ambiguous (status ${status ?? 'none'}): MAY have paid, verify payout on explorer before resolving`,
    true,
  );
}
