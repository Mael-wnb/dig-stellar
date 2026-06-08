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
