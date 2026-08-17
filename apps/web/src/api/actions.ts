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

// --- Execution witness (Lot R, R1) ----------------------------------------

export type WitnessRequest = {
  /** The submitted tx hash (the same one the explorer link uses). */
  txHash: string;
  network?: "testnet" | "mainnet";
  /** The app user id (localStorage uuid) so the API pins the owning wallet. */
  userId?: string;
};

export type WitnessResponse = {
  witnessed: boolean;
  /** On witnessed=false: which server-side check failed. */
  reason?:
    | "tx-not-found"
    | "tx-not-successful"
    | "unknown-wallet"
    | "no-qualifying-op"
    | "no-matching-build";
  alreadyWitnessed?: boolean;
  kind?: "sdex-swap" | "blend-deposit";
  notionalXlm?: number | null;
  minNotionalXlm?: number;
  meetsMinNotional?: boolean;
};

export async function submitActionWitness(
  payload: WitnessRequest
): Promise<WitnessResponse> {
  return apiFetch<WitnessResponse>("/actions/witness", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Fire-and-forget witness reporting after a successful swap / Blend deposit
 * submit. NEVER blocks or fails the action flow (Lot R rule). Retries a few
 * times because the widgets report the hash as soon as the network ACCEPTS the
 * tx (PENDING) — Horizon may not see it as successful for a few ledgers.
 * Re-witnessing is idempotent server-side, so retrying is always safe.
 */
export function reportActionWitness(payload: WitnessRequest): void {
  const RETRYABLE = new Set(["tx-not-found", "tx-not-successful"]);
  const DELAYS_MS = [4000, 6000, 6000, 6000];
  void (async () => {
    for (const delayMs of DELAYS_MS) {
      await new Promise((r) => setTimeout(r, delayMs));
      try {
        const res = await submitActionWitness(payload);
        if (res.witnessed || !RETRYABLE.has(res.reason ?? "")) {
          console.log("[witness]", payload.txHash, res);
          return;
        }
      } catch {
        // transient (network / 503) — retry on the next delay
      }
    }
    console.warn("[witness] gave up after retries", payload.txHash);
  })();
}

// --- Blend deposit (Testnet) ----------------------------------------------

export type BlendDepositRequest = {
  address: string;
  asset: "XLM" | "USDC";
  amount: string;
  network?: "testnet" | "mainnet";
  /**
   * Registry slug of the Blend pool to act on (Lot A5). The card always sends the
   * slug it resolved from its OWN registry, so the API acts on the same pool the
   * signing gate validates against. Absent = the network's default pool; an unknown
   * slug is a 400 (never a silent fallback).
   */
  pool?: string;
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

// --- Blend withdraw (Lot A3) ----------------------------------------------

/** Same shape as the deposit request — the withdraw is its mirror. */
export type BlendWithdrawRequest = BlendDepositRequest;

export type BlendWithdrawResponse = {
  /** The Soroban withdraw (InvokeHostFunction) XDR to sign. Empty when simulation failed. */
  xdr: string;
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

export async function buildBlendWithdraw(
  payload: BlendWithdrawRequest
): Promise<BlendWithdrawResponse> {
  return apiFetch<BlendWithdrawResponse>("/actions/blend/withdraw", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** One asset's supplied position, in human units (exact decimal strings). */
export type BlendAssetPosition = {
  sac: string;
  /** Collateralized supply — what the in-app deposit creates and the withdraw burns. */
  collateral: string;
  /** Non-collateral supply. The app never creates this; surfaced for honesty. */
  supply: string;
  /** Borrowed amount — non-zero means the health factor may limit a withdraw. */
  liabilities: string;
  decimals: number;
};

/**
 * The pool's LIVE on-chain status (A5b), derived server-side from the same PoolV2
 * load as the position — never from a registry (status is governance-dynamic).
 * Per the deployed contract: supply is blocked at status > 3 (Frozen/Setup);
 * withdrawals are NEVER status-blocked, so a user can always exit.
 */
export type BlendPoolStatus = {
  /** Raw on-chain status value (0–1 Active, 2–3 On-Ice, 4–5 Frozen, 6 Setup). */
  code: number;
  label: "Active" | "On-Ice" | "Frozen" | "Setup" | "Unknown";
  supplyBlocked: boolean;
  withdrawBlocked: boolean;
};

export type BlendPositionResponse = {
  poolId: string;
  /** Registry slug of the pool actually read (A5) — assert it matches what was asked. */
  poolSlug: string;
  poolLabel: string;
  /** The assets that pool has reserves for. */
  assets: Array<"XLM" | "USDC">;
  network: "testnet" | "mainnet";
  /** Live pool status (A5b) — what the supply gating + status badge key off. */
  poolStatus: BlendPoolStatus;
  positions: Record<"XLM" | "USDC", BlendAssetPosition>;
};

/**
 * The acting wallet's CURRENT Blend position, read live from chain by the API.
 * Informational only — it feeds the withdraw pane's "supplied" figure and Max; the
 * signing gate never validates against it.
 */
export async function fetchBlendPosition(payload: {
  address: string;
  network?: "testnet" | "mainnet";
  /** Registry slug of the pool to read (A5). Absent = the network default. */
  pool?: string;
}): Promise<BlendPositionResponse> {
  return apiFetch<BlendPositionResponse>("/actions/blend/position", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
