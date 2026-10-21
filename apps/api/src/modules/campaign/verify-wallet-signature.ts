// apps/api/src/modules/campaign/verify-wallet-signature.ts
//
// Lot EP (EP1): the ONE place in apps/api that verifies a wallet's signature
// over our challenge message. VERIFY-ONLY, PUBLIC KEY, HOLDS NO SECRET:
// the only stellar-sdk Keypair API used is Keypair.fromPublicKey(...).verify(...),
// which needs nothing but the public address. This file must never read an env
// variable, derive a keypair from a seed, generate a keypair, or sign anything;
// verify-wallet-signature.spec.ts asserts that against the source text and the
// behaviour. See docs/security-invariants.md §1 (INV-1.2 narrow exception).
//
// Signed-message byte forms: SEP-43 wallets do not all sign the same bytes. The
// helper accepts exactly three, in order, and reports which one matched so the
// proof row records it (wallet_ownership_proofs.signature_variant):
//   'raw'    — Ed25519 over the UTF-8 bytes of the message
//   'sha256' — Ed25519 over SHA-256(UTF-8 bytes of the message)
//   'sep53'  — Ed25519 over SHA-256(UTF-8("Stellar Signed Message:\n" + message))
//              (SEP-53; measured against Freighter 5.49.0 via Kit 1.9.5, 2026-10-21)
// Anything else is a mismatch. Signature encodings accepted: base64 (SEP-43)
// or hex, both decoding to exactly 64 bytes.

import { createHash } from 'node:crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

export type SignatureVariant = 'raw' | 'sha256' | 'sep53';

export type VerifyFailureReason =
  | 'invalid-address'
  | 'invalid-signature-encoding'
  | 'signature-mismatch';

export type VerifyWalletSignatureResult =
  | { ok: true; variant: SignatureVariant }
  | { ok: false; variant: null; reason: VerifyFailureReason };

const SIGNATURE_BYTES = 64;
/** SEP-53 domain-separation prefix, prepended to the message before hashing. */
const SEP53_PREFIX = 'Stellar Signed Message:\n';
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const HEX_RE = /^[0-9a-fA-F]+$/;

/** Decode a base64 or hex signature to exactly 64 bytes, else null. */
export function decodeSignature(signedMessage: string): Buffer | null {
  const trimmed = (signedMessage ?? '').trim();
  if (!trimmed) return null;

  if (HEX_RE.test(trimmed) && trimmed.length === SIGNATURE_BYTES * 2) {
    return Buffer.from(trimmed, 'hex');
  }
  if (BASE64_RE.test(trimmed)) {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === SIGNATURE_BYTES) return decoded;
  }
  return null;
}

function safeVerify(address: string, data: Buffer, signature: Buffer): boolean {
  try {
    return Keypair.fromPublicKey(address).verify(data, signature);
  } catch {
    return false;
  }
}

/**
 * Verify that `signedMessage` is the wallet `address`'s Ed25519 signature over
 * `message` (raw bytes first, then the SHA-256 form, then SEP-53). Pure: no
 * I/O, no env. Fails closed: no other byte form is tried.
 */
export function verifyWalletSignature(
  address: string,
  message: string,
  signedMessage: string,
): VerifyWalletSignatureResult {
  if (typeof address !== 'string' || !StrKey.isValidEd25519PublicKey(address)) {
    return { ok: false, variant: null, reason: 'invalid-address' };
  }

  const signature = decodeSignature(signedMessage);
  if (!signature) {
    return { ok: false, variant: null, reason: 'invalid-signature-encoding' };
  }

  const raw = Buffer.from(message ?? '', 'utf8');
  if (safeVerify(address, raw, signature)) return { ok: true, variant: 'raw' };

  const digest = createHash('sha256').update(raw).digest();
  if (safeVerify(address, digest, signature)) return { ok: true, variant: 'sha256' };

  const sep53 = createHash('sha256')
    .update(Buffer.from(SEP53_PREFIX + (message ?? ''), 'utf8'))
    .digest();
  if (safeVerify(address, sep53, signature)) return { ok: true, variant: 'sep53' };

  return { ok: false, variant: null, reason: 'signature-mismatch' };
}
