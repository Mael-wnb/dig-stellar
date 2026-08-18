// apps/web/src/config/mainnetSwapPairs.ts
//
// Vetted MAINNET (Pubnet) SDEX swap targets — the client-side intent source for the
// swap validation gate on mainnet (Lot A1, T3-D2). Mirrors the testnetSwapPairs.ts
// shape so SdexSwapWidget can swap one list for the other by network.
//
// This is UX + intent derivation; the SERVER whitelist (apps/api network-registry.ts,
// MAINNET_ASSET_WHITELIST) is the enforcement. Every (code, issuer) below MUST also be
// in that API whitelist — the two lists are cross-referenced both ways; a web pair
// missing from the API list 400s at build time. Re-verify BOTH before Mainnet ungating
// (see docs/runbooks.md).
//
// VETTING (Lot A1b — pairs are vetted by on-chain reality, not product preference).
// Probe: tools/probe-mainnet-pairs.mjs on 2026-08-01 (Horizon Pubnet /paths/strict-send,
// DIRECT routes only, XLM→asset AND asset→XLM at 10 XLM and at the 100 XLM launch cap).
// A pair is offered ONLY if BOTH directions PASS (cap-size rate ≥95% of small-size rate,
// matching the widget's 5% slippage tolerance) AND the issuer is verified against the
// issuing organization. Full evidence: docs/evidence/pair-vetting-2026-08-01.md.
//
//   pair        XLM→asset (deg)   asset→XLM (deg)   issuer verification
//   XLM↔USDC    0.00%  PASS       0.00%  PASS       circle.com — Circle official doc
//   XLM↔EURC    0.14%  PASS       0.01%  PASS       circle.com — Circle official doc
//   XLM↔AQUA    0.02%  PASS       0.02%  PASS       aqua.network stellar.toml declares issuer
//   XLM↔yXLM    0.00%  PASS       0.00%  PASS       ultracapital.xyz stellar.toml declares issuer
//   XLM↔PYUSD   0.00%  PASS       0.00%  PASS       token-metadata.paxos.com toml declares issuer
// Notable REJECTIONS (negative checks — INV-4.3 is exactly why): XRP (GBXRPL…, deep book
// but issuer fchain.io is NOT Ripple — a look-alike ticker with an unaffiliated issuer);
// VELO (both PASS but NO home_domain → unverifiable); wrapped BTC/ETH (ultracapital.xyz,
// domain-verified but held back — prefer stablecoins + native at launch). yUSDC/SHX are
// domain-verified survivors held out only for launch-set clarity, addable as one line each.

import type { TestnetSwapAsset, TestnetSwapPair } from "./testnetSwapPairs";

// Circle's canonical MAINNET USDC issuer on Stellar Pubnet.
// Verified 2026-08-01 against Circle's official usdc-contract-addresses doc.
export const MAINNET_USDC_ISSUER =
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// Cross-reference: every issuer below is mirrored in apps/api network-registry.ts
// (MAINNET_ASSET_WHITELIST). Keep the two lists in lock-step.
export const MAINNET_SWAP_PAIRS: TestnetSwapPair[] = [
  {
    id: "xlm-usdc",
    label: "XLM → USDC",
    from: { code: "XLM" },
    to: { code: "USDC", issuer: MAINNET_USDC_ISSUER },
    note: "Circle USDC: deepest XLM book on Pubnet.",
  },
  {
    id: "xlm-eurc",
    label: "XLM → EURC",
    from: { code: "XLM" },
    // Circle EURC — verified 2026-08-01 against Circle's eurc-contract-addresses doc.
    to: { code: "EURC", issuer: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2" },
    note: "Circle EURC (euro): direct book fills both ways at cap.",
  },
  {
    id: "xlm-aqua",
    label: "XLM → AQUA",
    from: { code: "XLM" },
    // Aquarius AQUA — issuer declared in aqua.network's stellar.toml.
    to: { code: "AQUA", issuer: "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA" },
    note: "Aquarius governance token: deep native book.",
  },
  {
    id: "xlm-yxlm",
    label: "XLM → yXLM",
    from: { code: "XLM" },
    // Ultra Capital yXLM — issuer declared in ultracapital.xyz's stellar.toml.
    to: { code: "yXLM", issuer: "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55" },
    note: "Ultra Capital yield-XLM: ~1:1 book.",
  },
  {
    id: "xlm-pyusd",
    label: "XLM → PYUSD",
    from: { code: "XLM" },
    // Paxos PYUSD (PayPal USD) — issuer declared in token-metadata.paxos.com stellar.toml.
    to: { code: "PYUSD", issuer: "GDQE7IXJ4HUHV6RQHIUPRJSEZE4DRS5WY577O2FY6YQ5LVWZ7JZTU2V5" },
    note: "PayPal USD (Paxos): direct book fills both ways at cap.",
  },
];

/**
 * The asset universe for the swap widget's From/To selectors on mainnet: native XLM
 * plus every distinct vetted target. Derived from MAINNET_SWAP_PAIRS so there is one
 * source of truth (same construction as TESTNET_SWAP_ASSETS).
 */
export const MAINNET_SWAP_ASSETS: TestnetSwapAsset[] = (() => {
  const seen = new Set<string>(["XLM"]);
  const list: TestnetSwapAsset[] = [{ code: "XLM" }];
  for (const p of MAINNET_SWAP_PAIRS) {
    const key = `${p.to.code}:${p.to.issuer}`;
    if (!seen.has(key)) {
      seen.add(key);
      list.push({ code: p.to.code, issuer: p.to.issuer });
    }
  }
  return list;
})();
