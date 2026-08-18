// apps/web/src/config/blendPools.ts
//
// Vetted Blend pools, per network — the CLIENT-SIDE intent source for the deposit /
// withdraw validation gates (lib/validateDepositXdr.ts, Lot A2 / A3 / A5). Everything
// the gate compares the returned XDR against (pool id, reserve SAC, classic USDC
// issuer) comes from HERE, never from the API response — that is the whole security
// property, and it is why Lot A5 keeps a full pool registry on the client rather than
// asking the API which pool it used.
//
// Each pool id + SAC MUST match the backend registry
// (apps/api/src/modules/actions/network-registry.ts → MAINNET_BLEND_POOLS /
// resolveBlendPool). The two are cross-referenced both ways; a divergence between
// them is a security bug, not a config drift. Re-verify BOTH before any Mainnet
// ungating (runbooks.md).
//
// Mainnet pool ids verified 2026-08-14 (evidence: docs/evidence/lot-a5-blend-multipool.md):
// Blend's official V2 pool factory answers is_pool()=true for all four, all four are
// in the backstop reward zone, all four share the A2-vetted Fixed pool's wasm hash
// (a41fc53d…), PoolV2.load succeeds for each (V2 confirmed), and each label below is
// the pool's own on-chain metadata.name.
//
// SACs are per-ASSET network constants — the SAME USDC/XLM SAC for every pool on a
// network — so they are defined ONCE per network below and shared by its pools. A new
// SAC is only ever needed for a new ASSET, which is its own change.

export type BlendNetwork = "testnet" | "mainnet";

export type BlendAssetCode = "XLM" | "USDC";

export interface BlendPoolAsset {
  code: BlendAssetCode;
  /** SAC (Soroban asset contract) id for this reserve — the deposit's request.address. */
  sac: string;
  /** Token decimals (7 on Stellar) — how the human amount is scaled to i128. */
  decimals: number;
  /** Short UI hint about what this asset needs to deposit. */
  note?: string;
}

export interface BlendPoolConfig {
  network: BlendNetwork;
  /** Registry slug — equals entities.slug, the id the product uses for this pool. */
  slug: string;
  /** Blend pool contract id — MUST equal the backend pool for this slug. */
  poolId: string;
  /** Human label for the pool header (the pool's on-chain name). */
  label: string;
  /** Depositable assets THIS pool actually has reserves for (XLM is the primary path). */
  assets: BlendPoolAsset[];
  /** The classic USDC asset the SAC deposit's trustline must point at (code AND issuer). */
  usdcClassic: { code: "USDC"; issuer: string };
  /** Soroban RPC for submitting the deposit on this network. */
  rpcUrl: string;
  /** Horizon for reading balances / classic trustlines on this network. */
  horizonUrl: string;
  /** stellar.expert path segment for tx links. */
  explorer: "public" | "testnet";
  /** True when deposits move real funds (mainnet) — drives the warning banner. */
  realFunds: boolean;
}

// --- Per-network, per-ASSET constants (shared by every pool on that network) ---

const TESTNET_ASSETS: Record<BlendAssetCode, BlendPoolAsset> = {
  XLM: {
    code: "XLM",
    sac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    decimals: 7,
    note: "Native: no trustline, funded by friendbot.",
  },
  USDC: {
    code: "USDC",
    sac: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
    decimals: 7,
    note: "Requires the SAC-backed testnet USDC (issuer GATALTGT…).",
  },
};

const MAINNET_ASSETS: Record<BlendAssetCode, BlendPoolAsset> = {
  XLM: {
    code: "XLM",
    // Native XLM SAC on Pubnet (== Asset.native().contractId(PUBLIC)).
    sac: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
    decimals: 7,
    note: "Native: no trustline. The simplest first mainnet deposit.",
  },
  USDC: {
    code: "USDC",
    // Circle USDC SAC on Pubnet (== USDC:GA5ZSE….contractId(PUBLIC)).
    sac: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    decimals: 7,
    note: "Circle USDC: a first deposit signs a trustline (step 1/2).",
  },
};

const TESTNET_USDC_CLASSIC = {
  code: "USDC",
  issuer: "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
} as const;

const MAINNET_USDC_CLASSIC = {
  code: "USDC",
  // Circle's canonical Pubnet USDC issuer (same as API MAINNET_USDC_ISSUER).
  issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
} as const;

function testnetPool(
  slug: string,
  poolId: string,
  label: string,
  codes: BlendAssetCode[],
): BlendPoolConfig {
  return {
    network: "testnet",
    slug,
    poolId,
    label,
    assets: codes.map((c) => TESTNET_ASSETS[c]),
    usdcClassic: TESTNET_USDC_CLASSIC,
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    explorer: "testnet",
    realFunds: false,
  };
}

function mainnetPool(
  slug: string,
  poolId: string,
  label: string,
  codes: BlendAssetCode[],
): BlendPoolConfig {
  return {
    network: "mainnet",
    slug,
    poolId,
    label,
    assets: codes.map((c) => MAINNET_ASSETS[c]),
    usdcClassic: MAINNET_USDC_CLASSIC,
    rpcUrl: "https://mainnet.sorobanrpc.com",
    horizonUrl: "https://horizon.stellar.org",
    explorer: "public",
    realFunds: true,
  };
}

// --- The registries ---------------------------------------------------------

/** Testnet keeps its single pool (no indexed testnet entities). */
export const TESTNET_BLEND_POOLS: BlendPoolConfig[] = [
  testnetPool(
    "blend-testnet-pool",
    "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
    "Blend Testnet Pool (V2)",
    ["XLM", "USDC"],
  ),
];

/**
 * Mainnet Blend pools — the indexed perimeter. Mirrors API MAINNET_BLEND_POOLS
 * entry-for-entry (slug, poolId, label, asset codes).
 */
export const MAINNET_BLEND_POOLS: BlendPoolConfig[] = [
  mainnetPool(
    "blend-fixed-pool",
    "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD",
    "Fixed",
    ["XLM", "USDC"],
  ),
  mainnetPool(
    "blend-yieldblox-pool",
    "CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS",
    "YieldBlox",
    ["XLM", "USDC"],
  ),
  // XLM ONLY — verified on-chain 2026-08-14: this pool has no USDC reserve. (The DB
  // still holds a stale April USDC reserve row for it; the registry is built from the
  // live SDK read, not from that.)
  mainnetPool(
    "blend-orbit-pool",
    "CAE7QVOMBLZ53CDRGK3UNRRHG5EZ5NQA7HHTFASEMYBWHG6MDFZTYHXC",
    "Orbit",
    ["XLM"],
  ),
  mainnetPool(
    "blend-etherfuse-pool",
    "CDMAVJPFXPADND3YRL4BSM3AKZWCTFMX27GLLXCML3PD62HEQS5FPVAI",
    "Etherfuse",
    ["XLM", "USDC"],
  ),
];

export const DEFAULT_BLEND_POOL_SLUG: Record<BlendNetwork, string> = {
  testnet: "blend-testnet-pool",
  mainnet: "blend-fixed-pool",
};

/** Every vetted pool for a network. */
export function blendPoolsFor(network: BlendNetwork): BlendPoolConfig[] {
  return network === "mainnet" ? MAINNET_BLEND_POOLS : TESTNET_BLEND_POOLS;
}

/**
 * The Blend pool config for a network and (optionally) a pool slug — the client-side
 * intent source for the signing gate.
 *
 *  - `slug` omitted → the network's DEFAULT pool (pre-A5 behavior, unchanged).
 *  - `slug` present and vetted → that pool.
 *  - `slug` present but UNKNOWN → **null**. The caller must then refuse to render a
 *    form: acting on an unvetted pool id is exactly what the gate exists to prevent,
 *    and this also covers a pool the indexer starts listing before the registry does.
 */
export function blendPoolFor(
  network: BlendNetwork,
  slug?: string | null,
): BlendPoolConfig | null {
  const pools = blendPoolsFor(network);
  const wanted = slug?.trim() || DEFAULT_BLEND_POOL_SLUG[network];
  return pools.find((p) => p.slug === wanted) ?? null;
}
