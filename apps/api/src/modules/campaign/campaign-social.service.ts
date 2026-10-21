// apps/api/src/modules/campaign/campaign-social.service.ts
//
// Lot EP (EP2): the self-declared social tasks — claim and delete. Same shape
// as CampaignService.enroll(): facts (SQL) → PURE decision (social-claims.ts)
// → writes, inside ONE transaction that starts with SELECT … FOR UPDATE on the
// wallet's enrollment row (rule H, the checkinToday shape). POINTS ONLY; every
// payload carries DISCLAIMER.
//
// PII: the handle is received, normalised by the controller, compared and
// stored here — and NEVER logged or returned. Payloads carry the claim id and
// the task key only.
//
// Delete (recon §9.4, required before launch; founder ruling 2026-10-21: SOFT):
// proof required, the claim must belong to the caller, the claim row gets
// deleted_at + a scrubbed handle (v7) and a negative 'adjust:social-delete'
// ledger row referencing the credited row is written in the same transaction.
// Works whether or not the campaign is still active: a person must always be
// able to remove their handle. The task can be claimed again afterwards; the
// GROSS daily cap still counts the deleted claim's points for that UTC day.

import { Injectable } from '@nestjs/common';
import { CAMPAIGN_ID, xRepostUrl } from './campaign-config';
import { DISCLAIMER, type SocialTaskKey } from './campaign-rules';
import { CampaignRepository, isUniqueViolation, violatedUniqueKey } from './campaign.repository';
import { CampaignService } from './campaign.service';
import {
  socialClaimEligibility,
  socialUniqueViolationReason,
  type SocialClaimReason,
  type SocialDeleteReason,
} from './social-claims';
import {
  findOwnedSocialClaim,
  findSocialLedgerRow,
  handleUsedByOtherWallet,
  insertSocialAward,
  insertSocialClaim,
  insertSocialDeleteAdjust,
  lockEnrollment,
  socialClaimHandles,
  socialPointsAwardedOn,
  softDeleteSocialClaim,
} from './social-claims.queries';

export type SocialClaimPayload =
  | { claimed: true; id: string; task: SocialTaskKey; points: number; disclaimer: string }
  | { claimed: false; reason: SocialClaimReason; disclaimer: string };

export type SocialDeletePayload =
  | { deleted: true; id: string; pointsReversed: number; disclaimer: string }
  | { deleted: false; reason: SocialDeleteReason; disclaimer: string };

@Injectable()
export class CampaignSocialService {
  constructor(
    private readonly repo: CampaignRepository,
    private readonly campaign: CampaignService,
  ) {}

  /** EP2: x-repost opens only once CAMPAIGN_X_REPOST_URL is set; the other tasks are always open. */
  static taskAvailable(task: string): boolean {
    return task === 'x-repost' ? xRepostUrl() != null : true;
  }

  async claim(params: { address: string; userId: string; task: string; handle: string }): Promise<SocialClaimPayload> {
    const w = this.campaign.window();
    const proven = await this.repo.hasBoundProof(params.address, params.userId);
    const taskAvailable = CampaignSocialService.taskAvailable(params.task);
    // Cheap honest early exits (window, proof, unknown/unavailable task) before taking the lock.
    const pre = socialClaimEligibility({
      window: w,
      proven,
      enrolled: true,
      task: params.task,
      taskAvailable,
      handle: params.handle,
      existingClaims: [],
      handleUsedByOtherWallet: false,
      awardedTodayPoints: 0,
    });
    if (!pre.ok) return { claimed: false, reason: pre.reason, disclaimer: DISCLAIMER };

    try {
      return await this.repo.transaction(async (r) => {
        const enrollment = await lockEnrollment(r.db, CAMPAIGN_ID, params.address);
        if (!enrollment) return { claimed: false, reason: 'not-enrolled', disclaimer: DISCLAIMER } as const;

        const day = await r.todayUtc();
        const existingClaims = await socialClaimHandles(r.db, CAMPAIGN_ID, enrollment.address);
        const usedElsewhere = await handleUsedByOtherWallet(r.db, CAMPAIGN_ID, params.handle, enrollment.address);
        const awardedToday = await socialPointsAwardedOn(r.db, CAMPAIGN_ID, enrollment.address, day);

        const decision = socialClaimEligibility({
          window: w,
          proven,
          enrolled: true,
          task: params.task,
          taskAvailable,
          handle: params.handle,
          existingClaims,
          handleUsedByOtherWallet: usedElsewhere,
          awardedTodayPoints: awardedToday,
        });
        if (!decision.ok) return { claimed: false, reason: decision.reason, disclaimer: DISCLAIMER } as const;

        const claim = await insertSocialClaim(r.db, {
          campaign: CAMPAIGN_ID,
          address: enrollment.address,
          taskKey: params.task,
          handle: params.handle,
        });
        await insertSocialAward(r.db, {
          campaign: CAMPAIGN_ID,
          address: enrollment.address,
          userId: enrollment.user_id,
          reason: decision.reason,
          basePoints: decision.basePoints,
          points: decision.points,
          claimId: claim.id,
          day,
        });
        return {
          claimed: true,
          id: claim.id,
          task: params.task as SocialTaskKey,
          points: decision.points,
          disclaimer: DISCLAIMER,
        } as const;
      });
    } catch (err) {
      // The per-wallet lock serialises one wallet; the handle index is the
      // cross-wallet backstop. Report a lost race as what it is.
      if (isUniqueViolation(err)) {
        const reason = socialUniqueViolationReason(violatedUniqueKey(err));
        if (reason) return { claimed: false, reason, disclaimer: DISCLAIMER };
      }
      throw err;
    }
  }

  async remove(params: { address: string; userId: string; id: string }): Promise<SocialDeletePayload> {
    const proven = await this.repo.hasBoundProof(params.address, params.userId);
    if (!proven) return { deleted: false, reason: 'ownership-proof-required', disclaimer: DISCLAIMER };

    return this.repo.transaction(async (r) => {
      const enrollment = await lockEnrollment(r.db, CAMPAIGN_ID, params.address);
      if (!enrollment) return { deleted: false, reason: 'not-found', disclaimer: DISCLAIMER } as const;

      const claim = await findOwnedSocialClaim(r.db, CAMPAIGN_ID, params.id, enrollment.address);
      if (!claim) return { deleted: false, reason: 'not-found', disclaimer: DISCLAIMER } as const;

      const credited = await findSocialLedgerRow(r.db, CAMPAIGN_ID, claim.id);
      if (credited && credited.points !== 0) {
        await insertSocialDeleteAdjust(r.db, {
          campaign: CAMPAIGN_ID,
          address: enrollment.address,
          userId: enrollment.user_id,
          adjustsId: credited.id,
          points: credited.points,
        });
      }
      await softDeleteSocialClaim(r.db, CAMPAIGN_ID, claim.id);
      return { deleted: true, id: claim.id, pointsReversed: credited?.points ?? 0, disclaimer: DISCLAIMER } as const;
    });
  }
}
