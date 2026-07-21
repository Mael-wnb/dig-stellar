// src/api/actions.ts
import { apiFetch } from "./client";

/**
 * An SDEX asset for the swap/quote endpoints. Either a legacy code string
 * ("XLM"/"USDC", USDC resolving server-side to the vetted Circle testnet issuer)
 * or an explicit { code, issuer } — the multi-pair widget always sends the latter
 * so the exact (code, issuer) is pinned end-to-end and client-validated before signing.
 */
export type SdexAssetRef =
  | "XLM"
  | "USDC"
  | { code: string; issuer?: string };

export type SdexSwapRequest = {
  address: string;
  fromAsset: SdexAssetRef;
  toAsset: SdexAssetRef;
  amount: string;
  minReceive: string;
  network?: "testnet" | "mainnet";
};

export type SdexSwapResponse = {
  xdr: string;
  operations: string[];
  fee: {
    inclusion: number;
    total: number;
  };
};

export async function buildSdexSwap(
  payload: SdexSwapRequest
): Promise<SdexSwapResponse> {
  return apiFetch<SdexSwapResponse>("/actions/sdex/swap", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type SdexQuoteRequest = {
  fromAsset: SdexAssetRef;
  toAsset: SdexAssetRef;
  amount: string;
  network?: "testnet" | "mainnet";
};

export type SdexQuoteResponse = {
  /** Echo of the input send amount. */
  sourceAmount: string;
  /** Estimated amount received (Horizon best direct route). */
  destAmount: string;
  /** destAmount / sourceAmount — how many `toAsset` per 1 `fromAsset`. */
  rate: number;
};

export async function quoteSdexSwap(
  payload: SdexQuoteRequest
): Promise<SdexQuoteResponse> {
  return apiFetch<SdexQuoteResponse>("/actions/sdex/quote", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// --- Blend deposit (Testnet) ----------------------------------------------

export type BlendDepositRequest = {
  address: string;
  asset: "XLM" | "USDC";
  amount: string;
  network?: "testnet" | "mainnet";
};

export type BlendDepositResponse = {
  /** The Soroban deposit (InvokeHostFunction) XDR to sign. Empty when simulation failed. */
  xdr: string;
  /**
   * Present when the user lacks the classic USDC trustline. Sign + confirm this
   * ChangeTrust ON-CHAIN, then re-request the deposit build (which can only be
   * simulated once the trustline exists).
   */
  changetrustXdr?: string;
  /**
   * True when the response carries ONLY the ChangeTrust step (`xdr` is empty): the
   * deposit couldn't be simulated because the classic trustline is missing.
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
};

export async function buildBlendDeposit(
  payload: BlendDepositRequest
): Promise<BlendDepositResponse> {
  return apiFetch<BlendDepositResponse>("/actions/blend/deposit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
