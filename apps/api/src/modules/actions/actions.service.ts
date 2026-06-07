import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  rpc,
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
  TESTNET_NETWORK_PASSPHRASE,
  TESTNET_BLEND_POOL,
  TESTNET_USDC_CLASSIC,
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

export interface SdexSwapParams {
  address: string;
  fromAsset: 'XLM' | 'USDC';
  toAsset: 'XLM' | 'USDC';
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

// Soroban protocol: InvokeHostFunction must be the only operation in its transaction.
// When a USDC trustline is missing, changetrustXdr (sequence S+1) must be signed and
// submitted before xdr (sequence S+2). Simulation footprint/auth are sequence-agnostic.

/** Converts a human-readable decimal string to an i128 BigInt with the given decimal precision. */
function toI128(amount: string, decimals: number): bigint {
  const [intStr, fracStr = ''] = amount.split('.');
  const frac = fracStr.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(intStr) * BigInt(10 ** decimals) + BigInt(frac);
}

/** Maps an asset name to its classic Stellar Asset (XLM = native, USDC = the testnet classic asset). */
function classicAsset(name: 'XLM' | 'USDC'): Asset {
  return name === 'XLM' ? Asset.native() : TESTNET_USDC_CLASSIC;
}

@Injectable()
export class ActionsService {
  private readonly rpcServer: rpc.Server;
  private readonly poolContract: PoolContractV2;

  constructor() {
    this.rpcServer = new rpc.Server(TESTNET_RPC_URL, { allowHttp: false });
    this.poolContract = new PoolContractV2(TESTNET_BLEND_POOL);
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

    const sendAsset = classicAsset(fromAsset);
    const destAsset = classicAsset(toAsset);

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
    if (toAsset !== 'XLM') {
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
      operations.push(`change_trust:${toAsset}`);
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
    operations.push(`path_payment_strict_send:${fromAsset}→${toAsset}`);

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
