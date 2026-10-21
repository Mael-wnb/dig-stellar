// apps/api/src/modules/campaign/campaign-config.ts
//
// Lot EP (EP1): campaign configuration. Env is read LAZILY (repo convention) so
// a restart picks up flag flips. Mirrors faucet-config.ts deliberately: the
// campaign module imports NOTHING from modules/faucet, modules/actions or
// modules/wallets — duplication is the isolation.
//
// POINTS ONLY: nothing here configures a payout, a key or a token. There is no
// reward amount, no treasury, no network to pay on.

/**
 * The campaign this build counts points against (campaign column everywhere).
 * A CODE constant, not an env — same reasoning as FAUCET_CAMPAIGN: an env would
 * only add a mislabeling foot-gun, and a new campaign is a code change anyway.
 */
export const CAMPAIGN_ID = 1;

/** Site name embedded in the challenge message so a signature cannot be replayed elsewhere. */
export const CAMPAIGN_SITE_NAME = 'Dig Stellar';

/** Challenge TTL: the wallet must sign within this window. */
export const CHALLENGE_TTL_SECONDS = 300;

/**
 * Max age of an UNBOUND proof (made without a session) when wallet-connect
 * recovery consumes it. Short on purpose: the proof is minted and consumed in
 * the same user gesture.
 */
export const RECOVERY_PROOF_MAX_AGE_SECONDS = 600;

/** Leaderboard: rows returned and in-process cache lifetime. */
export const LEADERBOARD_LIMIT = 50;
export const LEADERBOARD_CACHE_MS = 60_000;

/** CAMPAIGN_ENABLED kill-switch. Default OFF — everything deploys dark. */
export function isCampaignEnabled(): boolean {
  return process.env.CAMPAIGN_ENABLED === 'true';
}

/**
 * Campaign start (CAMPAIGN_STARTS_AT, ISO date) — REQUIRED for the campaign to
 * be active. Only witnesses whose tx closed (ledger_closed_at) at or after this
 * instant earn points: a pre-campaign action can never be re-earned.
 * FAIL-CLOSED: unset/unparseable = campaign not started.
 */
export function campaignStartsAt(): Date | null {
  const raw = process.env.CAMPAIGN_STARTS_AT?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * Optional campaign end (CAMPAIGN_ENDS_AT, ISO date). When set it is enforced
 * server-side; when unset there is no deadline and none is shown — never fake
 * urgency.
 */
export function campaignEndsAt(): Date | null {
  const raw = process.env.CAMPAIGN_ENDS_AT?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * EP2: the campaign post to repost (CAMPAIGN_X_REPOST_URL, https URL), served
 * in GET /v1/campaign rules.socialTasks['x-repost'].url. When unset the task is
 * listed as not yet available and cannot be claimed. Lazy like every flag.
 */
export function xRepostUrl(): string | null {
  const raw = process.env.CAMPAIGN_X_REPOST_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
