// src/api/campaign.ts
//
// Lot EP (EP1 + EP2): the ownership-proof + campaign endpoints. POINTS ONLY —
// the API's disclaimer travels in every campaign payload; the web renders it
// and never computes points, streaks or multipliers (recon §6). Every type
// below mirrors apps/api/src/modules/campaign/*.service.ts payloads 1:1; the
// EP1 routes are a frozen contract.
import { apiFetch } from "./client";

// --- Ownership proof (EP1) --------------------------------------------------

export interface AuthChallenge {
  address: string;
  nonce: string;
  /** Plain text the wallet signs; it states that this is NOT a transaction. */
  message: string;
  expiresAt: string;
}

export type AuthVerifyResult =
  | {
      ok: true;
      address: string;
      userId: string | null;
      verifiedAt: string;
      signatureVariant: "raw" | "sha256" | "sep53";
    }
  | { ok: false; reason: "challenge-invalid-or-expired" | "signature-invalid" };

export function requestAuthChallenge(address: string): Promise<AuthChallenge> {
  return apiFetch<AuthChallenge>("/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

export function verifyAuthChallenge(payload: {
  address: string;
  nonce: string;
  signedMessage: string;
  provider?: string | null;
  userId?: string | null;
}): Promise<AuthVerifyResult> {
  return apiFetch<AuthVerifyResult>("/auth/verify", {
    method: "POST",
    body: JSON.stringify({
      address: payload.address,
      nonce: payload.nonce,
      signedMessage: payload.signedMessage,
      ...(payload.provider ? { provider: payload.provider } : {}),
      ...(payload.userId ? { userId: payload.userId } : {}),
    }),
  });
}

// --- Campaign (EP1 reads/writes, EP2 social) --------------------------------

export type ActionKind = "sdex-swap" | "blend-deposit" | "blend-withdraw";
export type SocialTaskKey = "x-follow" | "x-repost" | "community-join";

export type CampaignInactiveReason =
  | "campaign-disabled"
  | "campaign-not-started"
  | "campaign-ended";

export type CampaignWriteReason =
  | CampaignInactiveReason
  | "ownership-proof-required"
  | "not-enrolled"
  | "already-enrolled"
  | "already-checked-in"
  | "invalid-referral-code"
  | "self-referral";

export type SocialClaimReason =
  | CampaignWriteReason
  | "unknown-task"
  | "task-unavailable"
  | "already-claimed"
  | "handle-mismatch"
  | "handle-already-used"
  | "social-daily-cap-reached";

/** One social task as the API serves it: points, where to do it, and whether it is open yet. */
export interface SocialTaskEntry {
  points: number;
  /** For x-repost: the campaign post (CAMPAIGN_X_REPOST_URL); null for the others / when unset. */
  url: string | null;
  /** False = listed as "coming soon" and refused by the API ('task-unavailable'). */
  available: boolean;
}

export interface CampaignRules {
  actions: Record<ActionKind, { basePoints: number; dailyCap: number; requiresMinNotional: boolean }>;
  streakDailyPoints: number;
  streakMultipliers: Array<{ minDays: number; multiplier: number }>;
  socialTasks: Record<SocialTaskKey, SocialTaskEntry>;
  socialDailyCap: number;
  referral: { referrer: number; referee: number };
}

export interface CampaignState {
  campaign: number;
  active: boolean;
  reason?: CampaignInactiveReason;
  startsAt: string | null;
  endsAt: string | null;
  rules: CampaignRules;
  disclaimer: string;
}

export interface CampaignTask extends SocialTaskEntry {
  key: SocialTaskKey;
  claimed: boolean;
  claimId: string | null;
  claimedAt: string | null;
}

export interface CampaignMe {
  campaign: number;
  active: boolean;
  reason?: CampaignInactiveReason;
  address: string;
  proven: boolean;
  enrolled: boolean;
  referralCode: string | null;
  referredBy: string | null;
  balance: number;
  streak: { current: number; multiplierForToday: number };
  checkedInToday: boolean;
  pendingVerification: number;
  tasks: CampaignTask[];
  perks: string[];
  disclaimer: string;
}

export interface CampaignLeaderboard {
  campaign: number;
  asOf: string;
  /** `address` is already shortened by the API (GABC…WXYZ) — never a full key. */
  rows: Array<{ rank: number; address: string; points: number }>;
  me: { rank: number; points: number } | null;
  disclaimer: string;
}

export type EnrollResult =
  | { enrolled: true; address: string; referralCode: string; referredBy: string | null; disclaimer: string }
  | { enrolled: false; reason: CampaignWriteReason; disclaimer: string };

export type CheckinResult =
  | { checkedIn: true; day: string; points: number; disclaimer: string }
  | { checkedIn: false; reason: CampaignWriteReason; disclaimer: string };

export type SocialClaimResult =
  | { claimed: true; id: string; task: SocialTaskKey; points: number; disclaimer: string }
  | { claimed: false; reason: SocialClaimReason; disclaimer: string };

export type SocialDeleteResult =
  | { deleted: true; id: string; pointsReversed: number; disclaimer: string }
  | { deleted: false; reason: "ownership-proof-required" | "not-found"; disclaimer: string };

export function fetchCampaign(): Promise<CampaignState> {
  return apiFetch<CampaignState>("/campaign");
}

export function fetchCampaignMe(address: string, userId: string): Promise<CampaignMe> {
  const qs = `?address=${encodeURIComponent(address)}&userId=${encodeURIComponent(userId)}`;
  // Polled after every write: never serve it from the HTTP cache.
  return apiFetch<CampaignMe>(`/campaign/me${qs}`, { cache: "no-store" });
}

export function fetchCampaignLeaderboard(address?: string | null): Promise<CampaignLeaderboard> {
  const qs = address ? `?address=${encodeURIComponent(address)}` : "";
  return apiFetch<CampaignLeaderboard>(`/campaign/leaderboard${qs}`);
}

export function enrollCampaign(payload: {
  address: string;
  userId: string;
  referralCode?: string | null;
}): Promise<EnrollResult> {
  return apiFetch<EnrollResult>("/campaign/enroll", {
    method: "POST",
    body: JSON.stringify({
      address: payload.address,
      userId: payload.userId,
      ...(payload.referralCode ? { referralCode: payload.referralCode } : {}),
    }),
  });
}

export function checkinCampaign(payload: { address: string; userId: string }): Promise<CheckinResult> {
  return apiFetch<CheckinResult>("/campaign/checkin", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function claimSocialTask(payload: {
  address: string;
  userId: string;
  task: SocialTaskKey;
  handle: string;
}): Promise<SocialClaimResult> {
  return apiFetch<SocialClaimResult>("/campaign/social", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteSocialClaim(
  id: string,
  payload: { address: string; userId: string },
): Promise<SocialDeleteResult> {
  return apiFetch<SocialDeleteResult>(`/campaign/social/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: JSON.stringify(payload),
  });
}
