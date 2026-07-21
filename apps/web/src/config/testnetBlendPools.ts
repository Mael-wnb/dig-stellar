// apps/web/src/config/testnetBlendPools.ts
//
// Vetted Testnet Blend pool(s) for the deposit card. Frontend-only config — no
// testnet entities in the DB. The pool id here MUST match the backend's
// TESTNET_BLEND_POOL (the deposit endpoint is pinned to one pool for this beta).
//
// Reality check (2026-07, soroban-testnet RPC, PoolContractV2.submit → simulate):
//   - Supplying XLM as collateral SIMULATES OK (minResourceFee ~0.06 XLM). This is
//     the reliably demoable path: native asset, no trustline, funded by friendbot.
//   - Supplying USDC needs the SAC-backed testnet USDC (issuer GATALTGT…, wrapping
//     TESTNET_USDC_SAC) — a DIFFERENT asset than the Circle USDC (GBBD47…) our SDEX
//     swap produces. A fresh account has none, so USDC deposit fails simulation
//     (Contract #13) until the account actually holds that SAC USDC. Surfaced
//     honestly in the UI rather than hidden.

export interface TestnetBlendAsset {
  code: "XLM" | "USDC";
  /** Short hint shown in the UI about what this asset needs to deposit. */
  note?: string;
}

export interface TestnetBlendPool {
  id: string;
  /** Blend pool contract id (matches backend TESTNET_BLEND_POOL). */
  contractId: string;
  label: string;
  assets: TestnetBlendAsset[];
}

export const TESTNET_BLEND_POOLS: TestnetBlendPool[] = [
  {
    id: "blend-testnet-v2",
    contractId: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
    label: "Blend Testnet Pool (V2)",
    assets: [
      { code: "XLM", note: "Native — no trustline; funded by friendbot." },
      {
        code: "USDC",
        note: "Requires the SAC-backed testnet USDC (issuer GATALTGT…).",
      },
    ],
  },
];

/** The single pool this beta targets. */
export const TESTNET_BLEND_POOL = TESTNET_BLEND_POOLS[0];
