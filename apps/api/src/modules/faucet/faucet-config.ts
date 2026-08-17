// apps/api/src/modules/faucet/faucet-config.ts
//
// R2 (Lot R — T3-D2): faucet configuration. Env is read LAZILY (the repo
// convention) so a restart picks up flag flips.
//
// ISOLATION RULE (Lot R security model): the faucet module imports NOTHING
// from the user action paths (modules/actions/**) and vice versa. The two
// Horizon endpoints + passphrases below therefore deliberately DUPLICATE the
// values in actions/network-registry.ts rather than import them — they are
// public network constants, and the duplication is the isolation.

import { Networks } from '@stellar/stellar-sdk';

export type FaucetNetwork = 'testnet' | 'mainnet';

const HORIZON_URLS: Record<FaucetNetwork, string> = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
};

const PASSPHRASES: Record<FaucetNetwork, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
};

/** FAUCET_ENABLED kill-switch. Default OFF — everything deploys dark. */
export function isFaucetEnabled(): boolean {
  return process.env.FAUCET_ENABLED === 'true';
}

/**
 * The network the faucet PAYS ON and whose witnesses qualify. Default testnet
 * (the R4 E2E network); the founder flips to mainnet at go-live. Any other
 * value is treated as testnet — never an accidental mainnet.
 */
export function faucetNetwork(): FaucetNetwork {
  return process.env.FAUCET_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
}

/** Reward per claim in XLM (FAUCET_REWARD_XLM, default 5). */
export function faucetRewardXlm(): number {
  const parsed = parseFloat(process.env.FAUCET_REWARD_XLM ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

/** Campaign budget in claims (FAUCET_MAX_CLAIMS, default 40). */
export function faucetMaxClaims(): number {
  const parsed = parseInt(process.env.FAUCET_MAX_CLAIMS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 40;
}

/**
 * Velocity brake: max claims accepted per rolling hour (FAUCET_HOURLY_CLAIM_CAP,
 * default 10). At the cap a full drain of the 200 XLM treasury takes ≥ 4 hours
 * of sustained abuse — long enough for the founder to see it and kill the flag.
 */
export function faucetHourlyClaimCap(): number {
  const parsed = parseInt(process.env.FAUCET_HOURLY_CLAIM_CAP ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

/**
 * Min XLM-equivalent notional for a witness to qualify — same env the witness
 * verifier stores per row (FAUCET_MIN_NOTIONAL_XLM, default 1). Read here only
 * for the campaign payload (promo copy); the eligibility DECISION uses the
 * per-row stored meets_min_notional, never a live re-check.
 */
export function faucetMinNotionalXlm(): number {
  const parsed = parseFloat(process.env.FAUCET_MIN_NOTIONAL_XLM ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Optional campaign deadline (FAUCET_ENDS_AT, ISO date). R3b rule: when set it
 * is ENFORCED server-side (a past date closes eligibility) and surfaced to the
 * promo as a real countdown; when unset (or unparseable) there is NO deadline
 * and no time pressure is shown anywhere — never fake urgency.
 */
export function faucetEndsAt(): Date | null {
  const raw = process.env.FAUCET_ENDS_AT?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function faucetHorizonUrl(network: FaucetNetwork): string {
  return HORIZON_URLS[network];
}

export function faucetNetworkPassphrase(network: FaucetNetwork): string {
  return PASSPHRASES[network];
}
