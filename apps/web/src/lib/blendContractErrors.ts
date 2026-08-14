// src/lib/blendContractErrors.ts
//
// Friendly rendering of Blend contract errors (Lot A5b).
//
// A failed Soroban simulation reaches the client as `simulation.error` — a raw
// HostError wall of text whose only user-relevant fact is the contract error code,
// e.g. "HostError: Error(Contract, #1206)\n\nEvent log …". This module maps the
// KNOWN Blend codes to one-line human messages and gives any unmapped code a
// compact generic line, so the raw text is never the primary message (it stays
// available behind a "details" disclosure — the API keeps it verbatim in the
// payload).
//
// Code list source: @blend-capital/blend-sdk v3.2.2, dist/esm/response_parser.js
// (ContractErrorType) — the SDK's own enum for these contracts. Only codes a
// supply/withdraw user can plausibly hit are mapped; the rest fall through to the
// generic line, which is honest and still names the code.

/** Messages for known Blend pool contract error codes (one line, user-facing). */
const KNOWN_BLEND_ERRORS: Record<number, string> = {
  // Common soroban-token errors
  8: "The amount must be a positive number.",
  10: "The account's balance can't cover this amount.",
  13: "The account is missing the trustline this asset needs.",

  // Pool request / state errors (blend-sdk ContractErrorType, 1200+)
  1200: "The pool rejected this request as malformed.",
  1205: "This action would leave the position below the pool's minimum health factor.",
  1206: "The pool's current status, set by Blend governance, blocks this action.",
  1207: "This action would push the reserve's utilization outside its allowed rate.",
  1208: "This pool's per-account position limit has been reached.",
  1210: "The pool's price oracle is stale — the pool refuses actions until it updates.",
  1220: "This deposit would exceed the pool's supply cap for this asset.",
  1223: "This reserve is currently disabled in the pool.",
  1224: "This amount is below the pool's minimum collateral requirement.",
};

export interface FriendlyContractError {
  /** One-line, user-facing message — the primary error copy. */
  message: string;
  /** The parsed contract error code (e.g. 1206). */
  code: number;
  /** The raw error text, verbatim — for the collapsible "details" disclosure. */
  raw: string;
}

const CONTRACT_ERROR_RE = /Error\(Contract, #(\d+)\)/;

/**
 * Parse a raw simulation/host error into a friendly one-liner.
 *
 * Returns null when the text carries no `Error(Contract, #N)` marker — the caller
 * should then keep its existing (non-contract) error copy unchanged.
 */
export function friendlyContractError(
  rawError: string | undefined | null,
): FriendlyContractError | null {
  if (!rawError) return null;
  const match = CONTRACT_ERROR_RE.exec(rawError);
  if (!match) return null;
  const code = parseInt(match[1], 10);
  const known = KNOWN_BLEND_ERRORS[code];
  return {
    message:
      known ?? `The pool contract rejected this action (code #${code}).`,
    code,
    raw: rawError,
  };
}
