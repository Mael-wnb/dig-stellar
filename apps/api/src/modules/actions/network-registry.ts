// apps/api/src/modules/actions/network-registry.ts
//
// Per-network configuration + Mainnet launch controls for non-custodial actions
// (T3-D2, Lot A1). See docs/security-invariants.md §4.
//
// PRINCIPLE (gate replacement, not gate removal): with every env flag unset — the
// default — this module resolves ONLY testnet, and the testnet config is re-exported
// unchanged from testnet-registry.ts. Mainnet stays fully behind the kill-switch.

import { Asset, Networks } from '@stellar/stellar-sdk';
import {
  TESTNET_RPC_URL,
  TESTNET_HORIZON_URL,
  TESTNET_NETWORK_PASSPHRASE,
  TESTNET_USDC_SDEX,
} from './testnet-registry';

export type ActionNetwork = 'testnet' | 'mainnet';

export interface NetworkConfig {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  /** Human network label used in error messages so they name the real network. */
  label: ActionNetwork;
}

// --- Mainnet constants ------------------------------------------------------

/** Classic (Horizon) endpoint for Stellar Pubnet. */
export const MAINNET_HORIZON_URL = 'https://horizon.stellar.org';

/** Default Soroban RPC for Mainnet; overridable via ACTIONS_MAINNET_RPC_URL. */
const DEFAULT_MAINNET_RPC_URL = 'https://mainnet.sorobanrpc.com';

// Circle's canonical MAINNET USDC issuer on Stellar Pubnet.
// Verified 2026-08-01 against Circle's official contract-addresses doc
// (developers.circle.com/stablecoins/usdc-contract-addresses). This value MUST
// equal apps/web/src/config/mainnetSwapPairs.ts — re-verify BOTH sides before any
// Mainnet ungating (see docs/runbooks.md, INV-4.3).
export const MAINNET_USDC_ISSUER =
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

/** Circle mainnet USDC as a classic Asset (SDEX swap target). */
export const MAINNET_USDC_SDEX = new Asset('USDC', MAINNET_USDC_ISSUER);

// --- Env-backed launch controls (read lazily so tests / restarts pick up state) ---

/** ACTIONS_MAINNET_ENABLED kill-switch (INV-4.1). Default OFF. */
export function isMainnetEnabled(): boolean {
  return process.env.ACTIONS_MAINNET_ENABLED === 'true';
}

/** Per-transaction send-amount cap in XLM (INV-4.2). Default 100. */
export function mainnetMaxSendXlm(): number {
  const raw = process.env.ACTIONS_MAINNET_MAX_SEND_XLM;
  const parsed = raw != null ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

/** Mainnet Soroban RPC URL (ACTIONS_MAINNET_RPC_URL override). */
export function mainnetRpcUrl(): string {
  return process.env.ACTIONS_MAINNET_RPC_URL || DEFAULT_MAINNET_RPC_URL;
}

// --- Resolution -------------------------------------------------------------

/** Full per-network endpoint + passphrase config. Testnet is re-exported verbatim. */
export function getNetworkConfig(network: ActionNetwork): NetworkConfig {
  if (network === 'testnet') {
    return {
      rpcUrl: TESTNET_RPC_URL,
      horizonUrl: TESTNET_HORIZON_URL,
      networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
      label: 'testnet',
    };
  }
  return {
    rpcUrl: mainnetRpcUrl(),
    horizonUrl: MAINNET_HORIZON_URL,
    networkPassphrase: Networks.PUBLIC,
    label: 'mainnet',
  };
}

/**
 * The vetted issuer-less-'USDC' SDEX target for a network. Testnet keeps Circle's
 * testnet issuer (TESTNET_USDC_SDEX); mainnet uses Circle's Pubnet issuer.
 */
export function vettedUsdcSdex(network: ActionNetwork): Asset {
  return network === 'testnet' ? TESTNET_USDC_SDEX : MAINNET_USDC_SDEX;
}

/**
 * Mainnet asset whitelist (INV-4.3) — the enforcement point extended by Lot A1b.
 *
 * Each entry is a {code, issuer} vetted on-chain (direct-book fills both directions
 * at the launch cap within the widget's 5% slippage tolerance) AND issuer-verified
 * against the issuing organization (never from memory). Adding a pair later is one
 * array entry here + one MAINNET_SWAP_PAIRS entry in apps/web — the two lists MUST
 * agree (a web pair missing here 400s at build time).
 *
 * Vetting evidence: docs/evidence/pair-vetting-2026-08-01.md (probe stdout + JSON).
 * Issuer verification (bidirectional domain / official docs):
 *   USDC  GA5ZSE… circle.com          — Circle official usdc-contract-addresses doc
 *   EURC  GDHU6W… circle.com          — Circle official eurc-contract-addresses doc
 *   AQUA  GBNZIL… aqua.network        — issuer declared in aqua.network stellar.toml
 *   yXLM  GARDNV… ultracapital.xyz    — issuer declared in ultracapital.xyz stellar.toml
 *   PYUSD GDQE7I… token-metadata.paxos.com — issuer declared in Paxos stellar.toml
 * Native XLM is implicitly allowed and never appears in this list.
 */
export const MAINNET_ASSET_WHITELIST: ReadonlyArray<{
  code: string;
  issuer: string;
}> = [
  { code: 'USDC', issuer: MAINNET_USDC_ISSUER },
  { code: 'EURC', issuer: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2' },
  { code: 'AQUA', issuer: 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA' },
  { code: 'yXLM', issuer: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55' },
  { code: 'PYUSD', issuer: 'GDQE7IXJ4HUHV6RQHIUPRJSEZE4DRS5WY577O2FY6YQ5LVWZ7JZTU2V5' },
];

/**
 * True iff an asset may be swapped on Mainnet (INV-4.3). The controller accepts
 * arbitrary {code, issuer} on testnet (vetted client-side); on Mainnet the SERVER is
 * the enforcement point and rejects anything outside MAINNET_ASSET_WHITELIST.
 *
 * - Native XLM is always allowed.
 * - An issuer-less 'USDC' (legacy string form) is allowed because the service resolves
 *   it to MAINNET_USDC_ISSUER (the whitelisted issuer).
 * - Any other asset must match a whitelist entry on code AND issuer. An explicit USDC
 *   (or EURC, …) with a different issuer — a look-alike token — is rejected.
 */
export function isWhitelistedMainnetAsset(ref: {
  code: string;
  issuer?: string;
}): boolean {
  if (ref.code === 'XLM' || ref.code === 'native') return true;
  if (ref.code === 'USDC' && ref.issuer === undefined) return true;
  return MAINNET_ASSET_WHITELIST.some(
    (a) => a.code === ref.code && a.issuer === ref.issuer,
  );
}
