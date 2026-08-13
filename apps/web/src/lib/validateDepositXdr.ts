// apps/web/src/lib/validateDepositXdr.ts
//
// Strict client-side validation of the Blend deposit AND withdraw XDRs the API returns, checked
// against an intent DERIVED FROM USER INPUT + client-side config (config/blendPools.ts),
// never from the API response. This is the Soroban-path equivalent of validateSwapXdr:
// the security gate that must pass BEFORE the wallet is asked to sign, so the tx we hand
// the wallet is exactly the deposit (or trustline) the user asked for and nothing else.
//
// PURE functions: no network, no wallet, no clock. Decode-and-compare only. Collect ALL
// violations (fail closed) so the UI can surface everything at once.
//
// SDK reality (verified against @stellar/stellar-sdk 14.x, and by decoding a real
// PoolContractV2.submit envelope — see the Lot A2 report):
//   - A decoded invokeHostFunction op exposes `func: xdr.HostFunction`; for a contract
//     call `func.invokeContract()` yields InvokeContractArgs with `.contractAddress()`
//     (ScAddress → Address.fromScAddress(...).toString()), `.functionName()` (ScSymbol
//     → .toString()) and `.args(): xdr.ScVal[]`.
//   - `scValToNative` decodes the submit args: addresses → 'G…'/'C…' strings, i128 →
//     bigint, u32 → number, the Request struct → { address, amount, request_type }.
//   - An UNSIGNED envelope does not embed its network passphrase (same as the swap gate):
//     the honest guards are (a) it parses under the intent passphrase, (b) that passphrase
//     is one this app signs on, (c) it is not a fee-bump. The caller MUST sign with the
//     SAME passphrase it validated with.

import {
  TransactionBuilder,
  FeeBumpTransaction,
  Networks,
  Address,
  scValToNative,
} from "@stellar/stellar-sdk";
import type { Asset, Operation, xdr } from "@stellar/stellar-sdk";

/** Network passphrases this app signs transactions on. */
const RECOGNIZED_NETWORKS: readonly string[] = [Networks.TESTNET, Networks.PUBLIC];

/**
 * Blend `submit` RequestType for supplying collateral. Verified against the
 * @blend-capital/blend-sdk source (pool enum: Supply=0, Withdraw=1,
 * SupplyCollateral=2, WithdrawCollateral=3, Borrow=4, Repay=5, …). A deposit is
 * ALWAYS SupplyCollateral; any other request type on a "deposit" is an injection.
 */
export const SUPPLY_COLLATERAL = 2;

/**
 * Blend `submit` RequestType for withdrawing supplied collateral — read from the
 * SAME @blend-capital/blend-sdk enum source, never from memory. A withdraw is
 * ALWAYS WithdrawCollateral.
 *
 * The two constants are what make the two gates mutually exclusive: a
 * SupplyCollateral envelope can never pass the withdraw gate, and a
 * WithdrawCollateral envelope can never pass the deposit gate. Note in particular
 * that WithdrawCollateral (3) is NOT Withdraw (1) — Withdraw unwinds a
 * non-collateral supply, which this app never creates, so it is rejected too.
 */
export const WITHDRAW_COLLATERAL = 3;

/**
 * Fee ceiling for a Soroban Blend `submit` (in stroops) on the TOTAL fee. Soroban
 * fees include the resource fee (observed ≈0.06 XLM for the deposit; the withdraw
 * is the same order of magnitude), so the cap is a generous 2 XLM (20,000,000
 * stroops) — ample headroom while still catching a corrupted or malicious fee field
 * before it can burn XLM at signing.
 */
const MAX_DEPOSIT_FEE_STROOPS = 20_000_000n;

/**
 * Fee ceiling for the classic ChangeTrust step (0.01 XLM). The API builds it at
 * BASE_FEE (100 stroops); this catches a corrupted fee field.
 */
const MAX_TRUSTLINE_FEE_STROOPS = 100_000n;

export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: string[] };

/**
 * The user's intent for a Blend `submit` action (deposit or withdraw), from user
 * input + client-side config. The two actions differ ONLY in the request type they
 * pin, which is why they share this shape and the validator below.
 */
export type BlendSubmitIntent = {
  /** The user's own public key. Source, `from`, `spender`, and `to` must all equal this. */
  sourceAccount: string;
  /** Expected Blend pool contract id (from config/blendPools.ts — never the API). */
  poolId: string;
  /** Expected reserve SAC (Soroban asset contract) for the chosen asset. */
  assetSac: string;
  /** Exact amount moved, as the user entered it (decimal string). */
  amount: string;
  /** Decimals of the chosen asset (7 on Stellar) — how `amount` scales to i128. */
  decimals: number;
  /** The network passphrase the user believes they are on (and will sign with). */
  networkPassphrase: string;
};

/** The user's intent for a Blend deposit (SupplyCollateral). */
export type DepositIntent = BlendSubmitIntent;

/** The user's intent for a Blend withdraw of supplied collateral (WithdrawCollateral). */
export type WithdrawIntent = BlendSubmitIntent;

/** The user's intent for the classic USDC trustline that precedes a first USDC deposit. */
export type TrustlineIntent = {
  /** The user's own public key. Tx source (and op source, if set) must equal this. */
  sourceAccount: string;
  /** The classic asset the ChangeTrust must establish — code AND issuer. */
  asset: { code: string; issuer: string };
  /** The network passphrase the user believes they are on (and will sign with). */
  networkPassphrase: string;
};

/**
 * Converts a non-negative decimal amount string to an integer scaled by 10^decimals
 * as a BigInt, for exact comparison. Returns null for anything that is not a valid
 * amount (negative, empty, non-numeric, or more fractional digits than `decimals`).
 */
function toScaled(amount: string, decimals: number): bigint | null {
  if (typeof amount !== "string") return null;
  if (!Number.isInteger(decimals) || decimals < 0) return null;
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [intPart, fracPart = ""] = trimmed.split(".");
  if (fracPart.length > decimals) return null;
  const frac = fracPart.padEnd(decimals, "0");
  return BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(frac);
}

/**
 * Shared preface for both validators: recognized-passphrase guard, parse under the
 * intent passphrase, fee-bump rejection, source-account check, and a total-fee cap.
 * Returns the decoded classic tx (never a fee-bump) on success, or null if an
 * unrecoverable failure means nothing else can be inspected.
 */
function decodeAndPreflight(
  xdr: string,
  opts: {
    sourceAccount: string;
    networkPassphrase: string;
    maxFeeStroops: bigint;
  },
  violations: string[],
): ReturnType<typeof TransactionBuilder.fromXDR> | null {
  if (!RECOGNIZED_NETWORKS.includes(opts.networkPassphrase)) {
    violations.push(
      `unrecognized network passphrase: ${JSON.stringify(opts.networkPassphrase)}`,
    );
  }

  let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    tx = TransactionBuilder.fromXDR(xdr, opts.networkPassphrase);
  } catch {
    violations.push("unparseable XDR");
    return null;
  }

  if (tx instanceof FeeBumpTransaction) {
    violations.push("unexpected fee-bump transaction wrapper");
    return null;
  }

  if (tx.source !== opts.sourceAccount) {
    violations.push(
      `source account mismatch: expected ${opts.sourceAccount}, got ${tx.source}`,
    );
  }

  let feeStroops: bigint | null;
  try {
    feeStroops = BigInt(tx.fee);
  } catch {
    feeStroops = null;
  }
  if (feeStroops === null || feeStroops < 0n) {
    violations.push(`fee is not a valid stroop amount: ${tx.fee}`);
  } else if (feeStroops > opts.maxFeeStroops) {
    violations.push(
      `fee exceeds cap: ${tx.fee} stroops > ${opts.maxFeeStroops} stroops`,
    );
  }

  return tx;
}

/**
 * Validates that `xdr` is exactly the Blend `submit` described by `intent`: a single
 * Soroban invokeHostFunction calling `submit` on the expected pool, carrying exactly
 * ONE request of exactly `expectedRequestType` against the expected asset SAC for the
 * exact amount, entirely on the user's own account. Collects ALL violations; only
 * unrecoverable failures stop inspection.
 *
 * `expectedRequestType` is the ONLY difference between the deposit and withdraw gates
 * — pinning it is what stops either from ever accepting the other's transaction (let
 * alone a Borrow or a Repay smuggled in under the same function name).
 */
function validateSubmitXdr(
  xdr: string,
  intent: BlendSubmitIntent,
  expectedRequestType: number,
  requestTypeLabel: string,
): ValidationResult {
  const violations: string[] = [];

  const tx = decodeAndPreflight(
    xdr,
    {
      sourceAccount: intent.sourceAccount,
      networkPassphrase: intent.networkPassphrase,
      maxFeeStroops: MAX_DEPOSIT_FEE_STROOPS,
    },
    violations,
  );
  if (!tx) return { ok: false, violations };

  const ops = tx.operations;
  const invokeOp = ops.find((o) => o.type === "invokeHostFunction") as
    | Operation.InvokeHostFunction
    | undefined;

  if (!invokeOp) {
    const seen = ops.map((o) => o.type).join(", ") || "none";
    violations.push(`no invokeHostFunction operation (found: ${seen})`);
    return { ok: false, violations };
  }

  // The invocation must be the SOLE op — Soroban forbids mixing other ops with an
  // invokeHostFunction anyway, and a hidden extra op would be an injection.
  if (ops.length !== 1) {
    violations.push(`expected exactly 1 operation, found ${ops.length}`);
  }

  // An op-level source would let the invocation act for a different account.
  if (invokeOp.source !== undefined && invokeOp.source !== intent.sourceAccount) {
    violations.push(
      `operation source mismatch: expected inherited/${intent.sourceAccount}, got ${invokeOp.source}`,
    );
  }

  // Decode the contract call. A non-invokeContract host function (upload/create) is
  // never a pool action.
  let contractId: string;
  let fnName: string;
  let args: xdr.ScVal[];
  try {
    const ic = invokeOp.func.invokeContract();
    contractId = Address.fromScAddress(ic.contractAddress()).toString();
    fnName = ic.functionName().toString();
    args = ic.args();
  } catch {
    violations.push("host function is not a contract call (invokeContract)");
    return { ok: false, violations };
  }

  // The invoked contract MUST be the expected pool (from client config).
  if (contractId !== intent.poolId) {
    violations.push(
      `pool contract mismatch: expected ${intent.poolId}, got ${contractId}`,
    );
  }

  if (fnName !== "submit") {
    violations.push(`unexpected contract function: expected "submit", got "${fnName}"`);
  }

  // submit(from, spender, to, requests) — decode the four args.
  if (args.length < 4) {
    violations.push(`malformed submit args: expected 4, found ${args.length}`);
    return { ok: false, violations };
  }

  let from: unknown;
  let spender: unknown;
  let to: unknown;
  let requests: unknown;
  try {
    from = scValToNative(args[0]);
    spender = scValToNative(args[1]);
    to = scValToNative(args[2]);
    requests = scValToNative(args[3]);
  } catch {
    violations.push("unable to decode submit arguments");
    return { ok: false, violations };
  }

  // from / spender / to must ALL be the user — never take on a position for, spend
  // from, or credit a foreign account.
  for (const [label, value] of [
    ["from", from],
    ["spender", spender],
    ["to", to],
  ] as const) {
    if (value !== intent.sourceAccount) {
      violations.push(
        `${label} mismatch: expected ${intent.sourceAccount}, got ${String(value)}`,
      );
    }
  }

  // Exactly one request, and it must be the expected request type against the
  // expected SAC for the exact amount.
  if (!Array.isArray(requests)) {
    violations.push("submit requests is not a list");
    return { ok: false, violations };
  }
  if (requests.length !== 1) {
    violations.push(`expected exactly 1 request, found ${requests.length}`);
  }

  const req = requests[0] as
    | { address?: unknown; amount?: unknown; request_type?: unknown }
    | undefined;
  if (!req || typeof req !== "object") {
    violations.push("submit request is missing or malformed");
    return { ok: false, violations };
  }

  if (Number(req.request_type) !== expectedRequestType) {
    violations.push(
      `request_type mismatch: expected ${requestTypeLabel} (${expectedRequestType}), got ${String(req.request_type)}`,
    );
  }

  if (req.address !== intent.assetSac) {
    violations.push(
      `request asset mismatch: expected SAC ${intent.assetSac}, got ${String(req.address)}`,
    );
  }

  const expected = toScaled(intent.amount, intent.decimals);
  let actual: bigint | null;
  try {
    actual = typeof req.amount === "bigint" ? req.amount : BigInt(req.amount as never);
  } catch {
    actual = null;
  }
  if (expected === null || actual === null) {
    violations.push(
      `request amount not a valid amount: xdr=${String(req.amount)}, intent=${intent.amount}`,
    );
  } else if (actual !== expected) {
    violations.push(
      `request amount mismatch: expected ${expected.toString()} (scaled), got ${actual.toString()}`,
    );
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/**
 * Validates that `xdr` is exactly the Blend DEPOSIT described by `intent` — a single
 * `submit` supplying the expected asset SAC as collateral (SupplyCollateral) for the
 * exact amount, entirely on the user's own account.
 *
 * A withdraw envelope FAILS this gate (request_type 3 ≠ 2).
 */
export function validateDepositXdr(xdr: string, intent: DepositIntent): ValidationResult {
  return validateSubmitXdr(xdr, intent, SUPPLY_COLLATERAL, "SupplyCollateral");
}

/**
 * Validates that `xdr` is exactly the Blend WITHDRAW described by `intent` — a single
 * `submit` withdrawing the expected asset SAC from collateral (WithdrawCollateral)
 * for the exact amount, back to the user's own account.
 *
 * Identical invariants to the deposit gate, including `to` === the user: `to` is the
 * account CREDITED with the withdrawn tokens, so a foreign `to` here would send the
 * user's funds away. A deposit envelope FAILS this gate (request_type 2 ≠ 3).
 *
 * NOTE — no cap is applied here, matching the API: a withdraw returns the user's own
 * funds to their own wallet, and capping it could strand a position larger than the
 * cap. The amount is still pinned EXACTLY to what the user asked for.
 */
export function validateWithdrawXdr(
  xdr: string,
  intent: WithdrawIntent,
): ValidationResult {
  return validateSubmitXdr(xdr, intent, WITHDRAW_COLLATERAL, "WithdrawCollateral");
}

/**
 * True when a decoded ChangeTrust op establishes a trustline for exactly `asset`
 * (code AND issuer). Rejects native, liquidity-pool trustlines, and any mismatch.
 * The limit is deliberately unconstrained (a wrong limit cannot credit a foreign
 * account or change the asset — worst case the deposit fails on-chain).
 */
function changeTrustMatches(
  op: Operation.ChangeTrust,
  asset: { code: string; issuer: string },
): boolean {
  const line = op.line as Asset;
  if (typeof line?.getCode !== "function" || typeof line?.isNative !== "function") {
    return false; // LiquidityPoolAsset or unexpected shape
  }
  if (line.isNative()) return false;
  return line.getCode() === asset.code && line.getIssuer() === asset.issuer;
}

/**
 * Validates that `xdr` is exactly the classic USDC trustline the first USDC deposit
 * needs: a single ChangeTrust for the expected asset (code AND issuer), on the user's
 * own account. Same fail-closed contract as the deposit validator.
 */
export function validateTrustlineXdr(
  xdr: string,
  intent: TrustlineIntent,
): ValidationResult {
  const violations: string[] = [];

  const tx = decodeAndPreflight(
    xdr,
    {
      sourceAccount: intent.sourceAccount,
      networkPassphrase: intent.networkPassphrase,
      maxFeeStroops: MAX_TRUSTLINE_FEE_STROOPS,
    },
    violations,
  );
  if (!tx) return { ok: false, violations };

  const ops = tx.operations;
  const ctOp = ops.find((o) => o.type === "changeTrust") as
    | Operation.ChangeTrust
    | undefined;

  if (!ctOp) {
    const seen = ops.map((o) => o.type).join(", ") || "none";
    violations.push(`no changeTrust operation (found: ${seen})`);
    return { ok: false, violations };
  }

  if (ops.length !== 1) {
    violations.push(`expected exactly 1 operation, found ${ops.length}`);
  }

  if (ctOp.source !== undefined && ctOp.source !== intent.sourceAccount) {
    violations.push(
      `operation source mismatch: expected inherited/${intent.sourceAccount}, got ${ctOp.source}`,
    );
  }

  if (!changeTrustMatches(ctOp, intent.asset)) {
    const line = ctOp.line as Asset;
    const got =
      typeof line?.getCode === "function" && typeof line?.isNative === "function"
        ? line.isNative()
          ? "native (XLM)"
          : `${line.getCode()}:${line.getIssuer()}`
        : "non-asset trustline (e.g. liquidity pool)";
    violations.push(
      `changeTrust asset mismatch: expected ${intent.asset.code}:${intent.asset.issuer}, got ${got}`,
    );
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
