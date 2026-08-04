// apps/web/src/config/blendPools.ts
//
// Vetted Blend deposit pools, per network — the CLIENT-SIDE intent source for the
// deposit validation gate (lib/validateDepositXdr.ts, Lot A2 / T3-D2). Everything the
// gate compares the returned XDR against (pool id, reserve SAC, classic USDC issuer)
// comes from HERE, never from the API response — that is the whole security property.
//
// Each pool id + SAC MUST match the backend's per-network Blend registry
// (apps/api/src/modules/actions/network-registry.ts getBlendConfig). The two are
// cross-referenced both ways; re-verify BOTH before any Mainnet ungating (runbooks.md).
//
// Mainnet constants (Fixed pool) re-verified 2026-08-04 against the prod DB
// (entities venue=Blend + reserve_snapshots) AND cryptographically: each SAC is the
// deterministic contractId of its classic asset on Pubnet (USDC SAC == USDC:GA5ZSE…,
// XLM SAC == native). The pool is a V2 pool (indexer loads it via PoolV2.load).

export type BlendNetwork = "testnet" | "mainnet";

export interface BlendPoolAsset {
  code: "XLM" | "USDC";
  /** SAC (Soroban asset contract) id for this reserve — the deposit's request.address. */
  sac: string;
  /** Token decimals (7 on Stellar) — how the human amount is scaled to i128. */
  decimals: number;
  /** Short UI hint about what this asset needs to deposit. */
  note?: string;
}

export interface BlendPoolConfig {
  network: BlendNetwork;
  /** Blend pool contract id — MUST equal the backend pool for this network. */
  poolId: string;
  /** Human label for the pool header. */
  label: string;
  /** Depositable assets (XLM is the primary, zero-prerequisite path). */
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

const TESTNET_BLEND_POOL_CONFIG: BlendPoolConfig = {
  network: "testnet",
  poolId: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
  label: "Blend Testnet Pool (V2)",
  assets: [
    {
      code: "XLM",
      sac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      decimals: 7,
      note: "Native — no trustline; funded by friendbot.",
    },
    {
      code: "USDC",
      sac: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
      decimals: 7,
      note: "Requires the SAC-backed testnet USDC (issuer GATALTGT…).",
    },
  ],
  usdcClassic: {
    code: "USDC",
    issuer: "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
  },
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  explorer: "testnet",
  realFunds: false,
};

const MAINNET_BLEND_POOL_CONFIG: BlendPoolConfig = {
  network: "mainnet",
  // Blend "Fixed" pool (the main ≈$171M-TVL pool). Matches API MAINNET_BLEND_POOL
  // and entities.slug 'blend-fixed-pool'.contract_address.
  poolId: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD",
  label: "Blend Fixed Pool",
  assets: [
    {
      code: "XLM",
      // Native XLM SAC on Pubnet (== Asset.native().contractId(PUBLIC)).
      sac: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
      decimals: 7,
      note: "Native — no trustline. The simplest first mainnet deposit.",
    },
    {
      code: "USDC",
      // Circle USDC SAC on Pubnet (== USDC:GA5ZSE….contractId(PUBLIC)).
      sac: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
      decimals: 7,
      note: "Circle USDC — a first deposit signs a trustline (step 1/2).",
    },
  ],
  usdcClassic: {
    code: "USDC",
    // Circle's canonical Pubnet USDC issuer (same as MAINNET_USDC_ISSUER).
    issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  },
  rpcUrl: "https://mainnet.sorobanrpc.com",
  horizonUrl: "https://horizon.stellar.org",
  explorer: "public",
  realFunds: true,
};

/** The Blend pool config for a network (client-side intent source for the gate). */
export function blendPoolFor(network: BlendNetwork): BlendPoolConfig {
  return network === "mainnet"
    ? MAINNET_BLEND_POOL_CONFIG
    : TESTNET_BLEND_POOL_CONFIG;
}
