// apps/api/src/modules/campaign/social-claims.ts
//
// Lot EP (EP2): PURE rules for the self-declared social tasks — handle
// normalisation and the claim decision. No I/O, no Nest, no env: every fact
// arrives as an input so social-claims.spec.ts covers every branch, exactly
// like campaign-rules.ts. The points values and the daily cap stay in
// campaign-rules.ts (SOCIAL_TASKS, SOCIAL_DAILY_CAP, socialAward); this file
// only ORDERS the checks and adds the handle rules.
//
// A handle is user-supplied PII (recon §9.4): it is stored normalised, never
// logged, never returned in a public payload, and the DELETE path removes it.
//
// "One handle per wallet": every claim of a wallet carries the same handle
// (handle-mismatch), and a handle already claimed by ANOTHER wallet — for any
// task — is refused (handle-already-used). The unique index on
// (campaign, task_key, handle_normalized) is the race backstop, mapped by its
// key columns like the enrolment keys.

import {
  SOCIAL_TASKS,
  socialAward,
  type SocialTaskKey,
  type WriteIneligibleReason,
  type CampaignWindow,
  campaignStatus,
} from './campaign-rules';

/** Normalised handle: 1–32 of a-z, 0-9, '_' or '.' (X allows 15; Discord up to 32). */
export const HANDLE_RE = /^[a-z0-9_.]{1,32}$/;

/** Trim, strip ONE leading '@', lowercase. Validation is the caller's (HANDLE_RE). */
export function normaliseHandle(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

export type SocialClaimReason =
  | WriteIneligibleReason
  | 'unknown-task'
  | 'task-unavailable'
  | 'already-claimed'
  | 'handle-mismatch'
  | 'handle-already-used'
  | 'social-daily-cap-reached';

export interface SocialClaimFacts {
  window: CampaignWindow;
  proven: boolean;
  enrolled: boolean;
  task: string;
  /** False when the task is in the catalogue but not open yet (x-repost without CAMPAIGN_X_REPOST_URL). */
  taskAvailable: boolean;
  /** Already normalised (normaliseHandle) and syntactically valid. */
  handle: string;
  /** This wallet's existing claims in the campaign (task key + handle). */
  existingClaims: ReadonlyArray<{ task_key: string; handle_normalized: string }>;
  /** True when another wallet already claimed any task with this handle. */
  handleUsedByOtherWallet: boolean;
  /** Social points already credited to this wallet today (UTC), GROSS — deleted claims still count. */
  awardedTodayPoints: number;
}

export type SocialClaimDecision =
  | { ok: true; reason: `social:${SocialTaskKey}`; basePoints: number; multiplier: 1; points: number }
  | { ok: false; reason: SocialClaimReason };

/** First failing condition, in check order (honest UX), then the award rule. */
export function socialClaimEligibility(f: SocialClaimFacts): SocialClaimDecision {
  const status = campaignStatus(f.window);
  if (!status.active) return { ok: false, reason: status.reason };
  if (!f.proven) return { ok: false, reason: 'ownership-proof-required' };
  if (!f.enrolled) return { ok: false, reason: 'not-enrolled' };
  if (!Object.prototype.hasOwnProperty.call(SOCIAL_TASKS, f.task)) return { ok: false, reason: 'unknown-task' };
  if (!f.taskAvailable) return { ok: false, reason: 'task-unavailable' };
  if (f.existingClaims.some((c) => c.task_key === f.task)) return { ok: false, reason: 'already-claimed' };
  if (f.existingClaims.some((c) => c.handle_normalized !== f.handle)) return { ok: false, reason: 'handle-mismatch' };
  if (f.handleUsedByOtherWallet) return { ok: false, reason: 'handle-already-used' };
  const award = socialAward(f.task, f.awardedTodayPoints);
  if (!award.award) return { ok: false, reason: award.reason };
  return { ok: true, reason: award.reason, basePoints: award.basePoints, multiplier: 1, points: award.points };
}

/** The reversal row written by the DELETE path (matches LEDGER_REASON_RE 'adjust:.+'). */
export const SOCIAL_DELETE_REASON = 'adjust:social-delete';

/** What a soft-deleted claim's handle column holds (v7): the handle itself leaves the row. */
export const DELETED_HANDLE = 'deleted';

export type SocialDeleteReason = 'ownership-proof-required' | 'not-found';

/** The two social_task_claims PARTIAL unique keys (v7, deleted_at is null), as violatedUniqueKey reports them. */
export const SOCIAL_CLAIM_TASK_KEY = 'campaign, lower(address), task_key';
export const SOCIAL_CLAIM_HANDLE_KEY = 'campaign, task_key, handle_normalized';

/** Map a 23505 on social_task_claims to the reason the race lost to; null for any other key. */
export function socialUniqueViolationReason(key: string | null): SocialClaimReason | null {
  if (key === SOCIAL_CLAIM_TASK_KEY) return 'already-claimed';
  if (key === SOCIAL_CLAIM_HANDLE_KEY) return 'handle-already-used';
  return null;
}
