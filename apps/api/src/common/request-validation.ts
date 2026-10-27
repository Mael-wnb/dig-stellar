// apps/api/src/common/request-validation.ts
//
// Lot SEC (G1): request-input primitives shared by every controller/service.
// Thin and syntactic: 400 for malformed input, every DECISION lives in the
// service. Born in the campaign module (Lot EP); promoted here so the wallet,
// alert and action paths validate the same way.
//
// Contract of every helper:
//   * `unknown` in — a body field or query param may be a string, an array
//     (repeated query keys), an object or a number; nothing is `.trim()`ed or
//     regex-tested before its type is checked;
//   * a plain BadRequestException naming the field out, never a 500;
//   * trimmed string (or null for the optional variants) on success.

import { BadRequestException } from '@nestjs/common';

/** Stellar account public key (StrKey ed25519, "G" + 55 base32 chars). */
export const STELLAR_PUBKEY_RE = /^G[A-Z2-7]{55}$/;
export const NONCE_RE = /^[0-9a-f]{32}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_SIGNATURE_CHARS = 512;

/** `value` as a trimmed string, or '' when it is not a string at all. */
function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Stellar public key (G…). Contract addresses (C…) are deliberately NOT
 * accepted here: whether a tracked wallet may be a contract is a later product
 * decision, and the balance reader (Horizon /accounts) only knows accounts.
 * Addresses are never case-folded — a lowercase form is not a Stellar address.
 */
export function requireAddress(value: unknown, field = 'address'): string {
  const v = asTrimmedString(value);
  if (!STELLAR_PUBKEY_RE.test(v)) {
    throw new BadRequestException(`${field} must be a Stellar public key (G…)`);
  }
  return v;
}

export function requireNonce(value: unknown): string {
  const v = asTrimmedString(value);
  if (!NONCE_RE.test(v)) throw new BadRequestException('nonce must be 32 lowercase hex characters');
  return v;
}

export function requireSignedMessage(value: unknown): string {
  const v = asTrimmedString(value);
  if (!v || v.length > MAX_SIGNATURE_CHARS) {
    throw new BadRequestException('signedMessage must be a non-empty base64 or hex string');
  }
  return v;
}

export function requireUserId(value: unknown, field = 'userId'): string {
  const v = asTrimmedString(value);
  if (!UUID_RE.test(v)) throw new BadRequestException(`${field} must be a UUID`);
  return v;
}

/** Absent/empty → null; present → must be a UUID (an array or object is "present and wrong"). */
export function optionalUserId(value: unknown, field = 'userId'): string | null {
  if (value == null || value === '') return null;
  return requireUserId(value, field);
}

export function requireUuid(value: unknown, field: string): string {
  const v = asTrimmedString(value);
  if (!UUID_RE.test(v)) throw new BadRequestException(`${field} must be a valid UUID`);
  return v;
}

/**
 * Optional free-text field (labels, providers…): absent/empty → null; a
 * non-string (array, object, number) → 400; longer than `maxChars` → 400.
 */
export function optionalText(value: unknown, field: string, maxChars: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  const v = value.trim();
  if (!v) return null;
  if (v.length > maxChars) {
    throw new BadRequestException(`${field} must be at most ${maxChars} characters`);
  }
  return v;
}

/**
 * Optional enum-like field with a default: absent → `fallback`; a non-string →
 * 400; otherwise lower-cased and trimmed for the caller's allow-list check.
 */
export function optionalKeyword(value: unknown, field: string, fallback: string): string {
  if (value == null) return fallback;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  const v = value.trim().toLowerCase();
  return v || fallback;
}
