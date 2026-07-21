// apps/web/src/config/testnetSwapPairs.ts
//
// Vetted Testnet SDEX swap targets. This is a FRONTEND-ONLY config list — no
// testnet entities ever enter the DB (prod aggregation/TVL/protocolCount must
// not move). It drives the Testnet Actions swap rows.
//
// WHY a hardcoded list (not a live discovery call): testnet SDEX liquidity is
// the historical failure mode — a configured issuer with no testnet order book
// makes a direct PathPaymentStrictSend fail with pathPaymentStrictSendTooFewOffers.
// So the swappable set is driven by ACTUAL testnet orderbook reality, probed via
// Horizon /paths/strict-send (the same oracle the backend /quote uses), not by
// product preference.
//
// Vetting (2026-07, horizon-testnet.stellar.org, strict-send from native XLM):
//   XLM → USDC (GBBD47…)  10 XLM → 19.06 USDC   8-level book, ~5.6k USDC depth   ✓ flagship
//   XLM → yXLM (GC63WR…)  10 XLM → 9.52 yXLM    direct, ~0.95 rate               ✓
//   XLM → AQUA (GC63WR…)  10 XLM → 0.09 AQUA    direct, fills at 5% slippage     ✓ (small units)
// Evaluated but EXCLUDED:
//   XLM → EURC (GDKH3M…)  an XLM offer exists, but /paths/strict-send returns 0
//                         fillable records → a direct swap would fail. Kept out
//                         on purpose (negative check).
//   meme AMM tokens (RHINO/NATURE/SUN/FLUTTER…) fill via AMM but are spam with
//                         absurd unit outputs — omitted for demo credibility.
//
// Acceptance bar per pair: a strict-send quote for a small amount succeeds AND
// the book has enough depth that a 5%-slippage min-receive fills. All three
// above clear it. If an entry's single seeded offer disappears on testnet, drop
// it here — no code change needed elsewhere.

/** A vetted testnet swap target. Send side is always native XLM for this beta. */
export interface TestnetSwapPair {
  /** Stable id for v-for keys and row state. */
  id: string;
  /** Human label for the row header, e.g. "XLM → USDC". */
  label: string;
  /** Asset sold. Fixed to native XLM for every vetted pair in this beta. */
  from: { code: "XLM" };
  /** Asset bought — code + classic issuer (this is what makes the pair fillable). */
  to: { code: string; issuer: string };
  /** Optional short hint shown under the row (e.g. liquidity caveat). */
  note?: string;
}

/** An asset that can appear in the From/To selectors. XLM carries no issuer. */
export interface TestnetSwapAsset {
  code: string;
  issuer?: string;
}

export const TESTNET_SWAP_PAIRS: TestnetSwapPair[] = [
  {
    id: "xlm-usdc",
    label: "XLM → USDC",
    from: { code: "XLM" },
    // Circle's canonical testnet USDC — deep XLM order book (multi-level).
    to: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
    note: "Deepest testnet book — the proven path.",
  },
  {
    id: "xlm-yxlm",
    label: "XLM → yXLM",
    from: { code: "XLM" },
    to: { code: "yXLM", issuer: "GC63WRH6PATVVKZPVJIBSEZ7E5Q4DIRI7LG22YD5MVR4RBFTBS7EZBRN" },
    note: "Direct order-book route (~1:0.95).",
  },
  {
    id: "xlm-aqua",
    label: "XLM → AQUA",
    from: { code: "XLM" },
    to: { code: "AQUA", issuer: "GC63WRH6PATVVKZPVJIBSEZ7E5Q4DIRI7LG22YD5MVR4RBFTBS7EZBRN" },
    note: "Direct route; small unit output at current testnet price.",
  },
];

/**
 * The asset universe for the swap widget's From/To selectors: native XLM plus every
 * distinct vetted target. Derived from TESTNET_SWAP_PAIRS so there is one source of
 * truth. NB: only XLM→target directions are known-fillable (per discovery — most
 * target→XLM books are empty); the reverse directions are still selectable and
 * surface the quote's clean "no liquidity for this direction" state.
 */
export const TESTNET_SWAP_ASSETS: TestnetSwapAsset[] = (() => {
  const seen = new Set<string>(["XLM"]);
  const list: TestnetSwapAsset[] = [{ code: "XLM" }];
  for (const p of TESTNET_SWAP_PAIRS) {
    const key = `${p.to.code}:${p.to.issuer}`;
    if (!seen.has(key)) {
      seen.add(key);
      list.push({ code: p.to.code, issuer: p.to.issuer });
    }
  }
  return list;
})();

/** Stable key for an asset ('XLM' for native, else 'CODE:ISSUER'). */
export function swapAssetKey(a: TestnetSwapAsset): string {
  return a.code === "XLM" ? "XLM" : `${a.code}:${a.issuer}`;
}
