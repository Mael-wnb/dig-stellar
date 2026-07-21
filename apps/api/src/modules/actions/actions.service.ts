import {
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
import {
  TESTNET_RPC_URL,
  TESTNET_HORIZON_URL,
  TESTNET_NETWORK_PASSPHRASE,
  TESTNET_BLEND_POOL,
  TESTNET_USDC_CLASSIC,
  TESTNET_USDC_SDEX,
  ASSET_DECIMALS,
  ASSET_SAC,
} from './testnet-registry';

export interface BlendDepositParams {
  address: string;
  asset: 'USDC' | 'XLM';
  amount: string;
}

export interface BlendDepositResult {
  xdr: string;
  /** Present when the user lacks the USDC trustline. Submit this tx first, then resubmit the deposit. */
  changetrustXdr?: string;
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

/**
 * Resolves a canonical AssetRef to a classic Stellar Asset used by the SDEX swap.
 * Native XLM maps to Asset.native(). The legacy issuer-less 'USDC' resolves to
 * Circle's vetted testnet USDC (TESTNET_USDC_SDEX) for backward compatibility with
 * the pre-multi-pair frontend; any other asset uses its explicit (code, issuer).
 * Blend uses TESTNET_USDC_CLASSIC directly and does not go through here.
 */
function resolveAsset(ref: AssetRef): Asset {
  if (isNativeRef(ref)) return Asset.native();
  if (ref.code === 'USDC' && !ref.issuer) return TESTNET_USDC_SDEX;
  if (!ref.issuer) {
    throw new UnprocessableEntityException(`issuer required for asset ${ref.code}`);
  }
  return new Asset(ref.code, ref.issuer);
}

@Injectable()
export class ActionsService {
  private readonly rpcServer: rpc.Server;
  private readonly horizonServer: Horizon.Server;
  private readonly poolContract: PoolContractV2;

  constructor() {
    this.rpcServer = new rpc.Server(TESTNET_RPC_URL, { allowHttp: false });
    this.horizonServer = new Horizon.Server(TESTNET_HORIZON_URL);
    this.poolContract = new PoolContractV2(TESTNET_BLEND_POOL);
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
    const { fromAsset, toAsset, amount } = params;
    const sendAsset = resolveAsset(fromAsset);
    const destAsset = resolveAsset(toAsset);
    const fromLabel = fromAsset.code;
    const toLabel = toAsset.code;

    let records: Horizon.ServerApi.PaymentPathRecord[];
    try {
      const resp = await this.horizonServer
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
        `No direct liquidity for ${fromLabel}→${toLabel} at this amount on testnet`,
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
    const { address, asset, amount } = params;
    const decimals = ASSET_DECIMALS[asset];
    const assetSac = ASSET_SAC[asset];
    const scaledAmount = toI128(amount, decimals);

    // Load account for sequence number. The private key never reaches this layer.
    let account: Account;
    try {
      account = await this.rpcServer.getAccount(address);
    } catch {
      throw new InternalServerErrorException(
        `Account ${address.slice(0, 8)}... not found on testnet`,
      );
    }

    // Save sequence before any TransactionBuilder.build() call increments it.
    const seqBeforeBuild = account.sequenceNumber();

    // Check USDC trustline via RPC. XLM is native — no trustline needed.
    let hasTrustline = true;
    if (asset === 'USDC') {
      try {
        const balanceResp = await this.rpcServer.getAssetBalance(
          address,
          TESTNET_USDC_CLASSIC,
        );
        hasTrustline = balanceResp.balanceEntry !== undefined;
      } catch {
        hasTrustline = false;
      }
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
      this.poolContract.submit(submitArgs),
      'base64',
    );

    // Simulate using a tx at sequence S+1 (using the original account, which gets
    // incremented by build()). Simulation results are independent of tx sequence.
    const txForSim = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
    })
      .addOperation(blendOp)
      .setTimeout(300)
      .build();

    const simResult = await this.rpcServer.simulateTransaction(txForSim);

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

    // Rebuild deposit tx with padded fee and apply simulation (auth + soroban data).
    // If ChangeTrust is needed first (seq S+1), deposit goes at seq S+2.
    // Otherwise deposit goes at seq S+1 (same sequence as simulation).
    const depositAccountSeq = hasTrustline
      ? seqBeforeBuild
      : String(BigInt(seqBeforeBuild) + 1n);
    const accountForDeposit = new Account(address, depositAccountSeq);
    const txForDeposit = new TransactionBuilder(accountForDeposit, {
      fee: totalFee.toString(),
      networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
    })
      .addOperation(blendOp)
      .setTimeout(300)
      .build();

    const finalTx = rpc.assembleTransaction(txForDeposit, simResult).build();
    const depositXdr = finalTx.toEnvelope().toXDR('base64');

    const operations: string[] = [`blend_supply_collateral:${asset}`];

    // Build a separate ChangeTrust tx when the user has no USDC trustline.
    // (Soroban protocol prohibits mixing InvokeHostFunction with classic ops in one tx.)
    let changetrustXdr: string | undefined;
    if (!hasTrustline) {
      const accountForChangeTrust = new Account(address, seqBeforeBuild);
      const ctTx = new TransactionBuilder(accountForChangeTrust, {
        fee: BASE_FEE,
        networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
      })
        .addOperation(Operation.changeTrust({ asset: TESTNET_USDC_CLASSIC }))
        .setTimeout(300)
        .build();
      changetrustXdr = ctTx.toEnvelope().toXDR('base64');
      operations.unshift(`change_trust:${asset}`);
    }

    return {
      xdr: depositXdr,
      ...(changetrustXdr !== undefined ? { changetrustXdr } : {}),
      operations,
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
   * Builds a classic Stellar DEX swap via PathPaymentStrictSend.
   *
   * Unlike the Blend deposit, this is a CLASSIC transaction: no simulateTransaction,
   * no assembleTransaction, no sorobanData. A missing destination trustline is bundled
   * as a ChangeTrust op in the SAME transaction (classic ops can be batched freely).
   */
  async buildSdexSwap(params: SdexSwapParams): Promise<SdexSwapResult> {
    const { address, fromAsset, toAsset, amount, minReceive } = params;

    const sendAsset = resolveAsset(fromAsset);
    const destAsset = resolveAsset(toAsset);
    const fromLabel = fromAsset.code;
    const toLabel = toAsset.code;

    // Load account for sequence number. The private key never reaches this layer.
    let account: Account;
    try {
      account = await this.rpcServer.getAccount(address);
    } catch {
      throw new InternalServerErrorException(
        `Account ${address.slice(0, 8)}... not found on testnet`,
      );
    }

    // Check destination trustline. XLM (native) never needs one.
    let needsTrustline = false;
    if (!isNativeRef(toAsset)) {
      try {
        const balanceResp = await this.rpcServer.getAssetBalance(address, destAsset);
        needsTrustline = balanceResp.balanceEntry === undefined;
      } catch {
        needsTrustline = true;
      }
    }

    const builder = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
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
