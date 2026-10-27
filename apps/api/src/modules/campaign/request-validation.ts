// apps/api/src/modules/campaign/request-validation.ts
//
// Lot EP (EP1): input validation shared by the auth and campaign controllers.
// Thin and syntactic (faucet-controller convention): 400 for malformed input,
// every DECISION lives in the service. Addresses are trimmed and must already
// be the uppercase StrKey form — nothing is case-folded (a lowercase "address"
// is not a Stellar address; the v6 CHECK constraints would refuse it anyway).
//
// Lot SEC (G1): the generic primitives (address, UUID, nonce, signature) moved
// to common/request-validation.ts so every module validates the same way; they
// are re-exported here so the campaign controllers are unchanged. Only the
// campaign-specific shapes (referral code, task, handle, claim id) live below.

import { BadRequestException } from '@nestjs/common';
import { optionalText } from '../../common/request-validation';
import { REFERRAL_CODE_RE } from './campaign-rules';
import { HANDLE_RE, normaliseHandle } from './social-claims';

export {
  STELLAR_PUBKEY_RE,
  NONCE_RE,
  UUID_RE,
  requireAddress,
  requireNonce,
  requireSignedMessage,
  requireUserId,
  optionalUserId,
} from '../../common/request-validation';

const MAX_PROVIDER_CHARS = 64;
const MAX_TASK_KEY_CHARS = 32;

export function optionalProvider(value: unknown): string | null {
  try {
    return optionalText(value, 'provider', MAX_PROVIDER_CHARS);
  } catch {
    throw new BadRequestException('provider must be a short string');
  }
}

export function optionalReferralCode(value: unknown): string | null {
  if (value == null || value === '') return null;
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!REFERRAL_CODE_RE.test(v)) throw new BadRequestException('referralCode must be 8 characters (A-Z, 2-9)');
  return v;
}

// --- Lot EP (EP2): social tasks ---------------------------------------------

/** Syntactic only: a short string. Whether it names a task is the rules' decision ('unknown-task'). */
export function requireTaskKey(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v || v.length > MAX_TASK_KEY_CHARS) throw new BadRequestException('task must be a short string');
  return v;
}

/** Normalised (lowercase, leading @ stripped) and validated; the raw value is never kept. */
export function requireHandle(value: unknown): string {
  const v = typeof value === 'string' ? normaliseHandle(value) : '';
  if (!HANDLE_RE.test(v)) {
    throw new BadRequestException('handle must be 1-32 characters: letters, digits, "_" or "."');
  }
  return v;
}

export function requireClaimId(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) {
    throw new BadRequestException('id must be a UUID');
  }
  return v;
}
