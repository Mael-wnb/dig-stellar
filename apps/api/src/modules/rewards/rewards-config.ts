// apps/api/src/modules/rewards/rewards-config.ts
//
// Lot EP (EP5): rewards configuration. MONEY PATH (docs/security-invariants.md
// §13). Env is read LAZILY (repo convention) so a restart picks up flag flips.
//
// The four PUBLIC values (REWARDS_ENABLED, REWARDS_DAILY_POOL_XLM,
// REWARDS_DAILY_CAP_XLM, REWARDS_MIN_CLAIM_XLM) are read in
// modules/campaign/campaign-config.ts because GET /v1/campaign serves them and
// the campaign module never imports from this module; they are re-exported
// here so the rewards code has one import for its config. The treasury secret
// env is NOT read here: exactly one file reads it, rewards-payout.service.ts.
//
// ISOLATION (faucet-config.ts pattern): this module imports NOTHING from
// modules/faucet, modules/actions or modules/wallets. The Horizon endpoints and
// passphrases below deliberately DUPLICATE the faucet's — public network
// constants; the duplication is the isolation.

import { Networks } from '@stellar/stellar-sdk';
import { STELLAR_PUBKEY_RE } from '../campaign/request-validation';

export {
  isRewardsEnabled,
  rewardsDailyPoolXlm,
  rewardsDailyCapXlm,
  rewardsMinClaimXlm,
  rewardsPublicRules,
  type RewardsPublicRules,
} from '../campaign/campaign-config';

export type RewardsNetwork = 'testnet' | 'mainnet';

const HORIZON_URLS: Record<RewardsNetwork, string> = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
};

const PASSPHRASES: Record<RewardsNetwork, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
};

/** Memo of every rewards payment (pinned by rewards-payout.spec.ts). */
export const REWARDS_PAYOUT_MEMO = 'dig-points';

/**
 * Treasury guard: a claim is refused when the treasury's native balance is
 * below total + this reserve (founder decision 2026-10-21). Covers the 1 XLM
 * base reserve of a fresh account plus fee headroom.
 */
export const TREASURY_RESERVE_XLM = 2;

/** One claim per wallet per rolling hour (counted on reward_claims.created_at, any status). */
export const CLAIM_RATE_LIMIT_MS = 60 * 60 * 1000;

/**
 * A closed UTC day D is allocated only once now >= D+1 00:00Z + this grace:
 * the award job's actions step may still write a late award for D in the
 * first minutes after midnight (a witness that closed at 23:5x and was posted
 * a little later), and a day is allocated once and never re-opened.
 */
export const ALLOCATION_GRACE_MS = 30 * 60 * 1000;

/**
 * The network the rewards PAY ON (REWARDS_NETWORK). Default testnet; the
 * founder sets 'mainnet' at activation. Any other value is treated as testnet —
 * never an accidental mainnet (faucet convention).
 */
export function rewardsNetwork(): RewardsNetwork {
  return process.env.REWARDS_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
}

/**
 * REWARDS_EXCLUDED_ADDRESSES: comma-separated G… addresses (team wallets) that
 * are never allocated and never counted in a day's Σ (INV-13.4). Returned
 * lower-cased for case-insensitive matching; malformed entries are dropped
 * (they could not match an enrolled wallet anyway).
 */
export function rewardsExcludedAddresses(): ReadonlySet<string> {
  const raw = process.env.REWARDS_EXCLUDED_ADDRESSES ?? '';
  const out = new Set<string>();
  for (const part of raw.split(',')) {
    const v = part.trim().toUpperCase(); // case-insensitive on purpose: an exclusion must never miss on case
    if (STELLAR_PUBKEY_RE.test(v)) out.add(v.toLowerCase());
  }
  return out;
}

export function rewardsHorizonUrl(network: RewardsNetwork): string {
  return HORIZON_URLS[network];
}

export function rewardsNetworkPassphrase(network: RewardsNetwork): string {
  return PASSPHRASES[network];
}
