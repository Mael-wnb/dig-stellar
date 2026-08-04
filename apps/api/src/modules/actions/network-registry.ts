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
  TESTNET_BLEND_POOL,
  TESTNET_USDC_SAC,
  TESTNET_XLM_SAC,
  TESTNET_USDC_CLASSIC,
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

// --- Mainnet Blend deposit registry (Lot A2, T3-D2) -------------------------
//
// Launch scope: the ONE Blend "Fixed" pool (the main ≈$171M-TVL pool). Every
// constant below was re-verified 2026-08-04 against the prod DB (entities where
// venue=Blend; reserve_snapshots for the pool) AND cross-checked cryptographically
// (the SACs are the deterministic contract ids of their classic assets on Pubnet):
//   - Fixed pool id  == entities.slug 'blend-fixed-pool'.contract_address, loaded
//     on-chain by the indexer via PoolV2.load (→ this IS a V2 pool; the builder uses
//     PoolContractV2). stellar.expert creator == the pool admin in DB metadata.
//   - USDC SAC       == Asset('USDC', MAINNET_USDC_ISSUER).contractId(PUBLIC), and
//     == the pool's USDC reserve contract_address in reserve_snapshots.
//   - XLM SAC        == Asset.native().contractId(PUBLIC), == the pool's native
//     reserve contract_address in reserve_snapshots.
// Re-verify all three against the DB + blend.capital before any Mainnet ungating
// (see docs/runbooks.md).

/** Blend "Fixed" pool (V2) on Pubnet — the single mainnet deposit target at launch. */
export const MAINNET_BLEND_POOL =
  'CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD';

/** Circle USDC Stellar Asset Contract (SAC) — the pool's USDC reserve. */
export const MAINNET_USDC_SAC =
  'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';

/** Native XLM Stellar Asset Contract (SAC) — the pool's native reserve. */
export const MAINNET_XLM_SAC =
  'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';

/**
 * The classic USDC asset the mainnet SAC deposit's trustline must point at. The
 * USDC SAC wraps Circle's classic USDC:GA5ZSE… (proven: the SAC id above is that
 * asset's deterministic contractId), so supplying it moves the classic balance and
 * requires this trustline first — exactly the testnet 2-step gate, on Pubnet.
 */
export const MAINNET_USDC_CLASSIC = new Asset('USDC', MAINNET_USDC_ISSUER);

/** Per-network Blend deposit config (pool + reserve SACs + classic USDC trustline). */
export interface BlendNetworkConfig {
  poolId: string;
  networkPassphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  /** SAC contract id per depositable asset. */
  sac: Record<'USDC' | 'XLM', string>;
  /** The classic USDC asset whose trustline the SAC deposit needs. */
  usdcClassic: Asset;
}

// --- Env-backed launch controls (read lazily so tests / restarts pick up state) ---

/** ACTIONS_MAINNET_ENABLED kill-switch (INV-4.1). Default OFF. Swap path only. */
export function isMainnetEnabled(): boolean {
  return process.env.ACTIONS_MAINNET_ENABLED === 'true';
}

/**
 * ACTIONS_MAINNET_BLEND_ENABLED kill-switch (Lot A2). Default OFF. The Blend
 * deposit gets its OWN switch so its mainnet rollout is independent of the swap:
 * with this unset the deposit stays testnet-only (mainnet → 403) even when the
 * swap kill-switch is on.
 */
export function isMainnetBlendEnabled(): boolean {
  return process.env.ACTIONS_MAINNET_BLEND_ENABLED === 'true';
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
 * Full per-network Blend deposit config. Testnet re-exports the testnet-registry
 * constants verbatim (so the testnet deposit stays byte-for-byte identical);
 * mainnet uses the Fixed-pool registry above.
 */
export function getBlendConfig(network: ActionNetwork): BlendNetworkConfig {
  if (network === 'testnet') {
    return {
      poolId: TESTNET_BLEND_POOL,
      networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
      rpcUrl: TESTNET_RPC_URL,
      horizonUrl: TESTNET_HORIZON_URL,
      sac: { USDC: TESTNET_USDC_SAC, XLM: TESTNET_XLM_SAC },
      usdcClassic: TESTNET_USDC_CLASSIC,
    };
  }
  return {
    poolId: MAINNET_BLEND_POOL,
    networkPassphrase: Networks.PUBLIC,
    rpcUrl: mainnetRpcUrl(),
    horizonUrl: MAINNET_HORIZON_URL,
    sac: { USDC: MAINNET_USDC_SAC, XLM: MAINNET_XLM_SAC },
    usdcClassic: MAINNET_USDC_CLASSIC,
  };
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
