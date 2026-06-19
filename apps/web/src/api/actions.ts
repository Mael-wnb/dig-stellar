// src/api/actions.ts
import { apiFetch } from "./client";

export type SdexSwapRequest = {
  address: string;
  fromAsset: "XLM" | "USDC";
  toAsset: "XLM" | "USDC";
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
  fromAsset: "XLM" | "USDC";
  toAsset: "XLM" | "USDC";
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
