// apps/web/src/lib/validateSwapXdr.ts
//
// Strict client-side validation of the swap XDR the API returns, checked against
// an intent DERIVED FROM USER INPUT (never from the API response). This is the
// security gate that must pass BEFORE the wallet is asked to sign: it guarantees
// the transaction we hand to the wallet is exactly the swap the user asked for
// and nothing else (no wrong asset/issuer, no extra op, no worse slippage, no
// spend from / credit to a foreign account).
//
// PURE function: no network, no wallet, no clock. Decode-and-compare only.
//
// SDK reality (verified against @stellar/stellar-sdk 14.6.1):
//   - A decoded PathPaymentStrictSend op exposes: `sendAsset: Asset`,
//     `sendAmount: string` (decimal, 7dp), `destination: string`, `destAsset: Asset`,
//     `destMin: string` (decimal), `path: Asset[]`, and `source?: string` (undefined
//     when unset — i.e. inherits the tx source).
//   - `Asset` exposes `.isNative()`, `.getCode()`, `.getIssuer()` (issuer undefined
//     for native).
//   - An UNSIGNED classic tx envelope does NOT embed its network passphrase:
//     `TransactionBuilder.fromXDR(xdr, wrongPassphrase)` succeeds and simply echoes
//     the passphrase you passed. There is therefore no "baked-in network" to compare
//     against. The network a tx executes on is bound at SIGN time by the passphrase.
//     The honest guards we can enforce here are (a) the XDR parses under the
//     intent passphrase, (b) that passphrase is a network this app actually signs on,
//     and (c) the tx is not a fee-bump wrapper. The caller MUST sign with the SAME
//     `intent.networkPassphrase` it validated with (the widget already derives both
//     from the same source). See the task report for the full rationale.

import { TransactionBuilder, FeeBumpTransaction, Networks } from '@stellar/stellar-sdk'
import type { Asset, Operation } from '@stellar/stellar-sdk'

/** An asset identity as the user's intent expresses it. */
export type AssetId = 'native' | { code: string; issuer: string }

export type SwapIntent = {
  /** The user's own public key. Source AND destination must equal this. */
  sourceAccount: string
  /** Asset being sold. */
  sendAsset: AssetId
  /** Exact amount sold, as the user entered it (decimal string). */
  sendAmount: string
  /** Asset being bought. */
  destAsset: AssetId
  /** Minimum acceptable amount received (slippage-adjusted, decimal string). */
  destMin: string
  /** The network passphrase the user believes they are on. */
  networkPassphrase: string
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: string[] }

/** Stellar amounts have 7 decimal places. */
const STELLAR_DECIMALS = 7

/** Network passphrases this app signs transactions on. */
const RECOGNIZED_NETWORKS: readonly string[] = [Networks.TESTNET, Networks.PUBLIC]

/**
 * Converts a non-negative decimal amount string to integer stroops (×10^7) as a
 * BigInt, so amounts can be compared exactly without floating-point error.
 * Returns null for anything that is not a valid Stellar amount (negative, empty,
 * non-numeric, or more than 7 fractional digits).
 */
function toStroops(amount: string): bigint | null {
  if (typeof amount !== 'string') return null
  const trimmed = amount.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const [intPart, fracPart = ''] = trimmed.split('.')
  if (fracPart.length > STELLAR_DECIMALS) return null
  const frac = fracPart.padEnd(STELLAR_DECIMALS, '0')
  return BigInt(intPart) * 10n ** BigInt(STELLAR_DECIMALS) + BigInt(frac)
}

/** True when a decoded SDK Asset matches the intent's asset identity (code AND issuer). */
function assetMatches(asset: Asset, id: AssetId): boolean {
  if (id === 'native') return asset.isNative()
  if (asset.isNative()) return false
  return asset.getCode() === id.code && asset.getIssuer() === id.issuer
}

/** Human label for an AssetId, for violation messages. */
function assetLabel(id: AssetId): string {
  return id === 'native' ? 'native (XLM)' : `${id.code}:${id.issuer}`
}

/** Human label for a decoded Asset, for violation messages. */
function decodedAssetLabel(asset: Asset): string {
  return asset.isNative() ? 'native (XLM)' : `${asset.getCode()}:${asset.getIssuer()}`
}

/**
 * Validates that `xdr` is exactly the swap described by `intent`. Collects ALL
 * violations rather than stopping at the first, so the UI can surface everything
 * that is wrong at once. Only unrecoverable failures (unparseable XDR, fee-bump
 * wrapper, missing target op) stop further inspection.
 */
export function validateSwapXdr(xdr: string, intent: SwapIntent): ValidationResult {
  const violations: string[] = []

  // (Network guard b) The passphrase must be one this app signs on. An empty or
  // bogus passphrase means we cannot make any network guarantee at all.
  if (!RECOGNIZED_NETWORKS.includes(intent.networkPassphrase)) {
    violations.push(
      `unrecognized network passphrase: ${JSON.stringify(intent.networkPassphrase)}`,
    )
  }

  // (Network guard a / parse) Decode under the intent passphrase. If this throws,
  // nothing else can be inspected.
  let tx: ReturnType<typeof TransactionBuilder.fromXDR>
  try {
    tx = TransactionBuilder.fromXDR(xdr, intent.networkPassphrase)
  } catch {
    violations.push('unparseable XDR')
    return { ok: false, violations }
  }

  // (Network guard c) A fee-bump wraps an inner tx with a separate fee source; the
  // swap ops live on the inner tx and the outer fee account could be anyone. Reject.
  if (tx instanceof FeeBumpTransaction) {
    violations.push('unexpected fee-bump transaction wrapper')
    return { ok: false, violations }
  }

  // Source account must be the user's own account — never sign a tx that spends
  // from someone else.
  if (tx.source !== intent.sourceAccount) {
    violations.push(
      `source account mismatch: expected ${intent.sourceAccount}, got ${tx.source}`,
    )
  }

  // Exactly one operation, and it must be a PathPaymentStrictSend. More than one
  // op (e.g. a hidden changeTrust / setOptions / extra payment) is a violation.
  const ops = tx.operations
  if (ops.length !== 1) {
    violations.push(`expected exactly 1 operation, found ${ops.length}`)
  }

  const swapOp = ops.find((o) => o.type === 'pathPaymentStrictSend') as
    | Operation.PathPaymentStrictSend
    | undefined

  if (!swapOp) {
    const seen = ops.map((o) => o.type).join(', ') || 'none'
    violations.push(`no pathPaymentStrictSend operation (found: ${seen})`)
    return { ok: false, violations }
  }

  // An op-level source would let the payment draw from a different account than
  // the tx source; it must be unset (inherit tx source) or equal the user.
  if (swapOp.source !== undefined && swapOp.source !== intent.sourceAccount) {
    violations.push(
      `operation source mismatch: expected inherited/${intent.sourceAccount}, got ${swapOp.source}`,
    )
  }

  // sendAsset — code AND issuer. A wrong issuer is how a look-alike token attack
  // sneaks in, so this is treated as critical.
  if (!assetMatches(swapOp.sendAsset, intent.sendAsset)) {
    violations.push(
      `sendAsset mismatch: expected ${assetLabel(intent.sendAsset)}, got ${decodedAssetLabel(swapOp.sendAsset)}`,
    )
  }

  // destAsset — code AND issuer.
  if (!assetMatches(swapOp.destAsset, intent.destAsset)) {
    violations.push(
      `destAsset mismatch: expected ${assetLabel(intent.destAsset)}, got ${decodedAssetLabel(swapOp.destAsset)}`,
    )
  }

  // sendAmount — exact, after decimal normalization (10 == 10.0000000).
  const sendActual = toStroops(swapOp.sendAmount)
  const sendIntent = toStroops(intent.sendAmount)
  if (sendActual === null || sendIntent === null) {
    violations.push(
      `sendAmount not a valid amount: xdr=${swapOp.sendAmount}, intent=${intent.sendAmount}`,
    )
  } else if (sendActual !== sendIntent) {
    violations.push(
      `sendAmount mismatch: expected ${intent.sendAmount}, got ${swapOp.sendAmount}`,
    )
  }

  // destMin — the on-chain minimum received must be AT LEAST what the user
  // accepted; a lower destMin means worse slippage than agreed.
  const minActual = toStroops(swapOp.destMin)
  const minIntent = toStroops(intent.destMin)
  if (minActual === null || minIntent === null) {
    violations.push(
      `destMin not a valid amount: xdr=${swapOp.destMin}, intent=${intent.destMin}`,
    )
  } else if (minActual < minIntent) {
    violations.push(
      `destMin below accepted minimum: expected >= ${intent.destMin}, got ${swapOp.destMin}`,
    )
  }

  // destination — a swap credits the user back; anyone else is a violation.
  if (swapOp.destination !== intent.sourceAccount) {
    violations.push(
      `destination mismatch: expected ${intent.sourceAccount}, got ${swapOp.destination}`,
    )
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}
