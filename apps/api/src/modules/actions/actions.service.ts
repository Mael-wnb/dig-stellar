import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  rpc,
  Horizon,
  Account,
  Asset,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
  Operation,
} from '@stellar/stellar-sdk';
import { PoolContractV2, RequestType } from '@blend-capital/blend-sdk';
import type { SubmitArgs, Request as BlendRequest } from '@blend-capital/blend-sdk';
import { ASSET_DECIMALS } from './testnet-registry';
import {
  type ActionNetwork,
  getNetworkConfig,
  getBlendConfig,
  vettedUsdcSdex,
} from './network-registry';

export interface BlendDepositParams {
  address: string;
  asset: 'USDC' | 'XLM';
  amount: string;
  network: ActionNetwork;
}

export interface BlendDepositResult {
  /** The Soroban deposit XDR. EMPTY when a trustline is still required (see below). */
  xdr: string;
  /**
   * Present when the user lacks the classic USDC trustline the SAC deposit needs.
   * The client MUST sign + confirm this ChangeTrust ON-CHAIN, then re-request the
   * deposit build (which can only be simulated once the trustline exists).
   */
  changetrustXdr?: string;
  /**
   * True when the response carries ONLY the ChangeTrust step: the deposit could not
   * be simulated because the classic trustline is missing (the SAC transfer would
   * trap with Contract #13). `xdr` is empty; establish the trustline first.
   */
  trustlineRequired?: boolean;
  operations: string[];
  simulation: {
    success: boolean;
    resourceFee: string;
    error?: string;
  };
  fee: {
    inclusion: number;
    resource: number;
    total: number;
  };
}

/**
 * A classic SDEX asset in canonical form. `code: 'XLM'` (or 'native') means the
 * native asset and carries no issuer; anything else requires a classic issuer.
 * The controller validates the shape before this reaches the service.
 */
export interface AssetRef {
  code: string;
  issuer?: string;
}

export interface SdexSwapParams {
  address: string;
  fromAsset: AssetRef;
  toAsset: AssetRef;
  amount: string;
  minReceive: string;
  network: ActionNetwork;
}

export interface SdexSwapResult {
  xdr: string;
  operations: string[];
  fee: {
    inclusion: number;
    total: number;
  };
}

export interface SdexQuoteParams {
  fromAsset: AssetRef;
  toAsset: AssetRef;
  amount: string;
  network: ActionNetwork;
}

export interface SdexQuoteResult {
  /** Echo of the input send amount (human-readable). */
  sourceAmount: string;
  /** Estimated amount received, from Horizon's best direct route. */
  destAmount: string;
  /** destAmount / sourceAmount — i.e. how many `toAsset` per 1 `fromAsset`. */
  rate: number;
}

// Soroban protocol: InvokeHostFunction must be the only operation in its transaction.
// When a USDC trustline is missing, changetrustXdr (sequence S+1) must be signed and
// submitted before xdr (sequence S+2). Simulation footprint/auth are sequence-agnostic.

/** Converts a human-readable decimal string to an i128 BigInt with the given decimal precision. */
function toI128(amount: string, decimals: number): bigint {
  const [intStr, fracStr = ''] = amount.split('.');
  const frac = fracStr.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(intStr) * BigInt(10 ** decimals) + BigInt(frac);
}

/** True for the native-asset ref ('XLM' or 'native'). */
function isNativeRef(ref: AssetRef): boolean {
  return ref.code === 'XLM' || ref.code === 'native';
}

// ── F2: spendable-balance preflight ────────────────────────────────────────
// Stellar locks part of an account's XLM (base + subentry reserves) and part of
// any balance (selling liabilities). A send amount above the *spendable* figure
// makes a swap/deposit fail on-chain (pathPaymentStrictSendUnderfunded) even though
// the raw balance looks sufficient. We preflight it so such a tx can't be signed.

/** Base reserve per account entry, in XLM. */
export const BASE_RESERVE_XLM = 0.5;
/** Fee/rounding headroom left free when sending native XLM, in XLM. */
export const XLM_FEE_BUFFER = 0.01;

/** Minimal Horizon-balance shape the spendable computation needs. */
export interface SpendableBalanceLine {
  asset_type: string; // 'native' | 'credit_alphanum4' | 'credit_alphanum12' | ...
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  selling_liabilities?: string;
}

/** Minimal Horizon-account shape the spendable computation needs. */
export interface SpendableAccountView {
  balances: SpendableBalanceLine[];
  subentryCount: number;
}

/** The send asset, reduced to what the spendable computation compares on. */
export interface SpendableAsset {
  isNative: boolean;
  code?: string;
  issuer?: string;
}

/**
 * Spendable balance of the send asset, honoring Stellar reserves & liabilities.
 *   native XLM: balance − (2 + subentries) × 0.5 reserve − selling_liabilities − fee buffer
 *   classic   : balance − selling_liabilities
 * Clamped at 0. Returns 0 when the account holds none of the asset (no trustline /
 * unfunded). Pure and SDK-free so it is unit-testable directly.
 */
export function computeSpendable(
  account: SpendableAccountView,
  send: SpendableAsset,
): number {
  if (send.isNative) {
    const native = account.balances.find((b) => b.asset_type === 'native');
    if (!native) return 0;
    const minBalance = (2 + account.subentryCount) * BASE_RESERVE_XLM;
    return Math.max(
      0,
      parseFloat(native.balance) -
        minBalance -
        parseFloat(native.selling_liabilities ?? '0') -
        XLM_FEE_BUFFER,
    );
  }
  const line = account.balances.find(
    (b) => b.asset_code === send.code && b.asset_issuer === send.issuer,
  );
  if (!line) return 0;
  return Math.max(
    0,
    parseFloat(line.balance) - parseFloat(line.selling_liabilities ?? '0'),
  );
}

/**
 * Resolves a canonical AssetRef to a classic Stellar Asset used by the SDEX swap.
 * Native XLM maps to Asset.native(). The legacy issuer-less 'USDC' resolves to the
 * network's vetted Circle USDC (testnet vs Pubnet issuer) for backward compatibility
 * with the pre-multi-pair frontend; any other asset uses its explicit (code, issuer).
 * Blend uses TESTNET_USDC_CLASSIC directly and does not go through here.
 */
function resolveAsset(ref: AssetRef, network: ActionNetwork): Asset {
  if (isNativeRef(ref)) return Asset.native();
  if (ref.code === 'USDC' && !ref.issuer) return vettedUsdcSdex(network);
  if (!ref.issuer) {
    throw new UnprocessableEntityException(`issuer required for asset ${ref.code}`);
  }
  return new Asset(ref.code, ref.issuer);
}

@Injectable()
export class ActionsService {
  // Per-network servers + pool contracts, built lazily on first use so no Mainnet
  // endpoint is contacted while both kill-switches are off. Shared by the swap and
  // the Blend deposit paths.
  private readonly rpcServers = new Map<ActionNetwork, rpc.Server>();
  private readonly horizonServers = new Map<ActionNetwork, Horizon.Server>();
  private readonly poolContracts = new Map<ActionNetwork, PoolContractV2>();

  /** Lazily-built Blend pool contract (V2) for the given network. */
  private poolContractFor(network: ActionNetwork): PoolContractV2 {
    let pool = this.poolContracts.get(network);
    if (!pool) {
      pool = new PoolContractV2(getBlendConfig(network).poolId);
      this.poolContracts.set(network, pool);
    }
    return pool;
  }

  /** Lazily-built Soroban RPC server for the swap path on the given network. */
  private rpcFor(network: ActionNetwork): rpc.Server {
    let server = this.rpcServers.get(network);
    if (!server) {
      server = new rpc.Server(getNetworkConfig(network).rpcUrl, { allowHttp: false });
      this.rpcServers.set(network, server);
    }
    return server;
  }

  /** Lazily-built Horizon server for the swap path on the given network. */
  private horizonFor(network: ActionNetwork): Horizon.Server {
    let server = this.horizonServers.get(network);
    if (!server) {
      server = new Horizon.Server(getNetworkConfig(network).horizonUrl);
      this.horizonServers.set(network, server);
    }
    return server;
  }

  /**
   * Live price quote for an SDEX swap, via Horizon /paths/strict-send.
   *
   * Uses the SAME assets as buildSdexSwap (swapAsset → TESTNET_USDC_SDEX), so the estimate
   * reflects the route the swap will actually take. The swap sends with `path: []` (direct,
   * single-hop only), so we quote only direct routes (records with an empty path). If none
   * exist, there is no liquidity the swap could use → 422 rather than an optimistic multi-hop
   * estimate that would later fail op_under_dest_min.
   */
  async quoteSdexSwap(params: SdexQuoteParams): Promise<SdexQuoteResult> {
    const { fromAsset, toAsset, amount, network } = params;
    const sendAsset = resolveAsset(fromAsset, network);
    const destAsset = resolveAsset(toAsset, network);
    const fromLabel = fromAsset.code;
    const toLabel = toAsset.code;

    let records: Horizon.ServerApi.PaymentPathRecord[];
    try {
      const resp = await this.horizonFor(network)
        .strictSendPaths(sendAsset, amount, [destAsset])
        .call();
      records = resp.records;
    } catch {
      throw new InternalServerErrorException(
        'Failed to fetch swap quote from Horizon',
      );
    }

    // Direct routes only — match the swap's `path: []`. A multi-hop best price would be
    // unreachable by the actual transaction.
    const direct = records.filter((r) => r.path.length === 0);
    if (direct.length === 0) {
      throw new UnprocessableEntityException(
        `No direct liquidity for ${fromLabel}→${toLabel} at this amount on ${network}`,
      );
    }

    const best = direct.reduce((a, b) =>
      parseFloat(b.destination_amount) > parseFloat(a.destination_amount) ? b : a,
    );

    const destAmount = best.destination_amount;
    const rate = parseFloat(destAmount) / parseFloat(amount);

    return { sourceAmount: amount, destAmount, rate };
  }

  async buildBlendDeposit(params: BlendDepositParams): Promise<BlendDepositResult> {
    const { address, asset, amount, network } = params;
    const cfg = getBlendConfig(network);
    const rpcServer = this.rpcFor(network);
    const poolContract = this.poolContractFor(network);
    const decimals = ASSET_DECIMALS[asset];
    const assetSac = cfg.sac[asset];
    const scaledAmount = toI128(amount, decimals);

    // Load account for sequence number. The private key never reaches this layer.
    let account: Account;
    try {
      account = await rpcServer.getAccount(address);
    } catch {
      throw new InternalServerErrorException(
        `Account ${address.slice(0, 8)}... not found on ${network}`,
      );
    }

    // Save sequence before any TransactionBuilder.build() call increments it.
    const seqBeforeBuild = account.sequenceNumber();

    // Trustline gate (USDC only; XLM is native and needs no trustline).
    //
    // The Blend USDC reserve is a SAC (cfg.sac.USDC) wrapping the CLASSIC asset
    // cfg.usdcClassic (testnet USDC:GATALTGT / Circle mainnet USDC:GA5ZSE…).
    // Supplying it moves the classic balance, so the account MUST hold a classic
    // trustline to that issuer first — otherwise the SAC transfer traps with
    // Contract #13 ("trustline entry is missing"). We cannot even SIMULATE the
    // deposit until that trustline exists (proven on testnet).
    //
    // So when the trustline is absent we return ONLY the ChangeTrust step and stop:
    // the client signs + confirms it on-chain, then re-requests this build (which can
    // now be simulated). This is what makes the 2-step honest — the deposit is never
    // built, signed, or submitted while the trustline is missing.
    //
    // Load the Horizon account once — it feeds both the USDC trustline gate and the
    // F2 spendable preflight below. Null when it can't be loaded (fail-safe per check).
    const horizonAccount = await this.loadHorizonAccount(address, network);

    if (asset === 'USDC') {
      const hasTrustline = horizonAccount
        ? this.hasTrustlineOnAccount(horizonAccount, cfg.usdcClassic)
        : false;
      if (!hasTrustline) {
        const ctTx = new TransactionBuilder(
          new Account(address, seqBeforeBuild),
          { fee: BASE_FEE, networkPassphrase: cfg.networkPassphrase },
        )
          .addOperation(Operation.changeTrust({ asset: cfg.usdcClassic }))
          .setTimeout(300)
          .build();
        const inclusionFee = parseInt(BASE_FEE, 10);
        return {
          xdr: '',
          changetrustXdr: ctTx.toEnvelope().toXDR('base64'),
          trustlineRequired: true,
          operations: ['change_trust:USDC'],
          simulation: {
            success: false,
            resourceFee: '0',
            error: 'USDC trustline required before deposit',
          },
          fee: { inclusion: inclusionFee, resource: 0, total: inclusionFee },
        };
      }
    }

    // F2 preflight: the deposit moves the send asset — native XLM, or the classic
    // USDC the SAC wraps (its trustline is guaranteed present by the gate above).
    // Reject an amount above spendable with a clean 400 before the costly simulation.
    // Fail-open when the account couldn't be loaded (no regression).
    if (horizonAccount) {
      const depositAsset = asset === 'XLM' ? Asset.native() : cfg.usdcClassic;
      this.assertSpendable(horizonAccount, depositAsset, amount, asset);
    }

    // Build the Blend SupplyCollateral operation (base64 XDR → xdr.Operation).
    const request: BlendRequest = {
      request_type: RequestType.SupplyCollateral,
      address: assetSac,
      amount: scaledAmount,
    };
    const submitArgs: SubmitArgs = {
      from: address,
      spender: address,
      to: address,
      requests: [request],
    };
    const blendOp = xdr.Operation.fromXDR(
      poolContract.submit(submitArgs),
      'base64',
    );

    // Simulate using a tx at sequence S+1 (using the original account, which gets
    // incremented by build()). Simulation results are independent of tx sequence.
    const txForSim = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: cfg.networkPassphrase,
    })
      .addOperation(blendOp)
      .setTimeout(300)
      .build();

    const simResult = await rpcServer.simulateTransaction(txForSim);

    if (rpc.Api.isSimulationError(simResult) || rpc.Api.isSimulationRestore(simResult)) {
      const error = rpc.Api.isSimulationError(simResult)
        ? simResult.error
        : 'contract entry requires footprint restore';
      return {
        xdr: '',
        operations: [],
        simulation: { success: false, resourceFee: '0', error },
        fee: { inclusion: 0, resource: 0, total: 0 },
      };
    }

    const inclusionFee = parseInt(BASE_FEE, 10);
    const minResourceFee = parseInt(simResult.minResourceFee, 10);
    const paddedResourceFee = Math.ceil(minResourceFee * 1.2);
    const totalFee = inclusionFee + paddedResourceFee;

    // Rebuild the deposit tx with the padded fee and apply the simulation
    // (auth + soroban data). The trustline (for USDC) is guaranteed to exist by the
    // gate above, so this is a single InvokeHostFunction tx at sequence S — no
    // bundled ChangeTrust (Soroban forbids mixing classic ops with it anyway).
    const accountForDeposit = new Account(address, seqBeforeBuild);
    const txForDeposit = new TransactionBuilder(accountForDeposit, {
      fee: totalFee.toString(),
      networkPassphrase: cfg.networkPassphrase,
    })
      .addOperation(blendOp)
      .setTimeout(300)
      .build();

    const finalTx = rpc.assembleTransaction(txForDeposit, simResult).build();
    const depositXdr = finalTx.toEnvelope().toXDR('base64');

    return {
      xdr: depositXdr,
      trustlineRequired: false,
      operations: [`blend_supply_collateral:${asset}`],
      simulation: {
        success: true,
        resourceFee: simResult.minResourceFee,
      },
      fee: {
        inclusion: inclusionFee,
        resource: paddedResourceFee,
        total: totalFee,
      },
    };
  }

  /**
   * Loads the account from Horizon (balances + subentry count) for the trustline
   * gate and the F2 spendable preflight. Returns null when the account can't be
   * loaded (unfunded / not found / Horizon hiccup) — callers decide the fail-safe:
   * the trustline gate treats null as "needs a trustline"; the spendable preflight
   * treats null as "can't measure → don't block" (fail-open, no regression).
   */
  private async loadHorizonAccount(
    address: string,
    network: ActionNetwork,
  ): Promise<Horizon.AccountResponse | null> {
    try {
      return await this.horizonFor(network).loadAccount(address);
    } catch {
      return null;
    }
  }

  /**
   * Classic-trustline check from an already-loaded Horizon account — the source of
   * truth for what Contract #13 ("trustline entry is missing") tests. Horizon's
   * balances list is unambiguous (unlike rpc.getAssetBalance, which throws on a
   * missing trustline and is easy to mis-handle).
   */
  private hasTrustlineOnAccount(
    account: Horizon.AccountResponse,
    asset: Asset,
  ): boolean {
    return account.balances.some(
      (b) =>
        'asset_code' in b &&
        b.asset_code === asset.getCode() &&
        'asset_issuer' in b &&
        b.asset_issuer === asset.getIssuer(),
    );
  }

  /** Adapts a Horizon account to the SDK-free shape computeSpendable consumes. */
  private toSpendableView(
    account: Horizon.AccountResponse,
  ): SpendableAccountView {
    return {
      subentryCount: account.subentry_count,
      balances: account.balances.map((b) => ({
        asset_type: b.asset_type,
        asset_code: 'asset_code' in b ? b.asset_code : undefined,
        asset_issuer: 'asset_issuer' in b ? b.asset_issuer : undefined,
        balance: b.balance,
        selling_liabilities:
          'selling_liabilities' in b ? b.selling_liabilities : '0',
      })),
    };
  }

  /**
   * F2 preflight: throws a clean 400 (INSUFFICIENT_SPENDABLE_BALANCE) when the send
   * amount exceeds what the account can actually spend once Stellar reserves and
   * selling liabilities are subtracted. This is what stops an underfunded swap/deposit
   * from ever reaching the signing step. `label` is the human asset code for the message.
   */
  private assertSpendable(
    account: Horizon.AccountResponse,
    sendAsset: Asset,
    requested: string,
    label: string,
  ): void {
    const native = sendAsset.isNative();
    const spendable = computeSpendable(this.toSpendableView(account), {
      isNative: native,
      code: native ? undefined : sendAsset.getCode(),
      issuer: native ? undefined : sendAsset.getIssuer(),
    });
    if (parseFloat(requested) > spendable) {
      const available = spendable.toFixed(7);
      throw new BadRequestException({
        code: 'INSUFFICIENT_SPENDABLE_BALANCE',
        message: `Insufficient spendable ${label} balance: ${available} available — the rest is reserved by the Stellar network`,
        asset: label,
        spendable: available,
        requested,
      });
    }
  }

  /**
   * Builds a classic Stellar DEX swap via PathPaymentStrictSend.
   *
   * Unlike the Blend deposit, this is a CLASSIC transaction: no simulateTransaction,
   * no assembleTransaction, no sorobanData. A missing destination trustline is bundled
   * as a ChangeTrust op in the SAME transaction (classic ops can be batched freely).
   */
  async buildSdexSwap(params: SdexSwapParams): Promise<SdexSwapResult> {
    const { address, fromAsset, toAsset, amount, minReceive, network } = params;
    const config = getNetworkConfig(network);

    const sendAsset = resolveAsset(fromAsset, network);
    const destAsset = resolveAsset(toAsset, network);
    const fromLabel = fromAsset.code;
    const toLabel = toAsset.code;

    // Load account for sequence number. The private key never reaches this layer.
    let account: Account;
    try {
      account = await this.rpcFor(network).getAccount(address);
    } catch {
      throw new InternalServerErrorException(
        `Account ${address.slice(0, 8)}... not found on ${network}`,
      );
    }

    // Load the Horizon account once: it feeds both the F2 spendable preflight and
    // the destination-trustline gate (INV-5.1). Null when the account can't be
    // loaded — each check applies its own fail-safe below.
    const horizonAccount = await this.loadHorizonAccount(address, network);

    // F2 preflight: reject a send that exceeds the spendable send-asset balance
    // (reserves + selling liabilities) with a clean 400 — before any XDR is built,
    // so the underfunded failure mode can't reach signing. Fail-open when the
    // account couldn't be loaded (no regression vs. today's behavior).
    if (horizonAccount) {
      this.assertSpendable(horizonAccount, sendAsset, amount, fromLabel);
    }

    // Check destination trustline. XLM (native) never needs one.
    // Horizon is the authoritative source for classic trustlines. The previous
    // rpc.getAssetBalance-based check misreported existing trustlines as missing,
    // re-bundling a redundant ChangeTrust into the envelope (INV-5.1: ChangeTrust
    // must be present IFF the trustline is genuinely missing). A Horizon load
    // failure (null) → we bundle the ChangeTrust: redundant is a no-op, missing
    // guarantees op_no_trust.
    let needsTrustline = false;
    if (!isNativeRef(toAsset)) {
      needsTrustline = horizonAccount
        ? !this.hasTrustlineOnAccount(horizonAccount, destAsset)
        : true;
    }

    const builder = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    });

    const operations: string[] = [];

    // ChangeTrust must precede the path payment so the destination asset can be received.
    if (needsTrustline) {
      builder.addOperation(Operation.changeTrust({ asset: destAsset }));
      operations.push(`change_trust:${toLabel}`);
    }

    builder.addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset,
        sendAmount: amount,
        destination: address,
        destAsset,
        destMin: minReceive,
        path: [],
      }),
    );
    operations.push(`path_payment_strict_send:${fromLabel}→${toLabel}`);

    const tx = builder.setTimeout(300).build();

    const inclusionPerOp = parseInt(BASE_FEE, 10);
    const totalFee = inclusionPerOp * operations.length;

    return {
      xdr: tx.toEnvelope().toXDR('base64'),
      operations,
      fee: {
        inclusion: inclusionPerOp,
        total: totalFee,
      },
    };
  }
}
