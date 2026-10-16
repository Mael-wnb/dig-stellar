// apps/api/src/modules/campaign/request-validation.ts
//
// Lot EP (EP1): input validation shared by the auth and campaign controllers.
// Thin and syntactic (faucet-controller convention): 400 for malformed input,
// every DECISION lives in the service. Addresses are trimmed and must already
// be the uppercase StrKey form — nothing is case-folded (a lowercase "address"
// is not a Stellar address; the v6 CHECK constraints would refuse it anyway).

import { BadRequestException } from '@nestjs/common';
import { REFERRAL_CODE_RE } from './campaign-rules';

export const STELLAR_PUBKEY_RE = /^G[A-Z2-7]{55}$/;
export const NONCE_RE = /^[0-9a-f]{32}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SIGNATURE_CHARS = 512;
const MAX_PROVIDER_CHARS = 64;

export function requireAddress(value: unknown, field = 'address'): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!STELLAR_PUBKEY_RE.test(v)) {
    throw new BadRequestException(`${field} must be a Stellar public key (G…)`);
  }
  return v;
}

export function requireNonce(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!NONCE_RE.test(v)) throw new BadRequestException('nonce must be 32 lowercase hex characters');
  return v;
}

export function requireSignedMessage(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v || v.length > MAX_SIGNATURE_CHARS) {
    throw new BadRequestException('signedMessage must be a non-empty base64 or hex string');
  }
  return v;
}

export function requireUserId(value: unknown, field = 'userId'): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!UUID_RE.test(v)) throw new BadRequestException(`${field} must be a UUID`);
  return v;
}

export function optionalUserId(value: unknown): string | null {
  if (value == null || value === '') return null;
  return requireUserId(value);
}

export function optionalProvider(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_PROVIDER_CHARS) {
    throw new BadRequestException('provider must be a short string');
  }
  return value.trim();
}

export function optionalReferralCode(value: unknown): string | null {
  if (value == null || value === '') return null;
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!REFERRAL_CODE_RE.test(v)) throw new BadRequestException('referralCode must be 8 characters (A-Z, 2-9)');
  return v;
}
