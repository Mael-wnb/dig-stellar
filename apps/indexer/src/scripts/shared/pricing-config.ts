// apps/indexer/src/scripts/shared/pricing-config.ts
// Phase B (2026-10-14): Reflector is the PRIMARY source for every asset it lists
// (REFLECTOR_CEX_TICKERS for the external feed; the Stellar DEX feed lists our
// tokens by contract id — read once per run). The rule below is the FALLBACK when
// Reflector is absent and the CROSS-CHECK when it is primary (shared/price-select.ts).
export type SanityBandRule = { minUsd: number; maxUsd: number; maxMove24hPct: number };

export type PricingRule =
  | { kind: 'coingecko'; id: string; fallbackEnvVar?: string; sanity?: SanityBandRule }
  | { kind: 'stable'; priceUsd: number; note?: string }
  | { kind: 'proxy'; base: 'BTC' | 'XLM' }
  // Reflector primary; fallback = deepest constant-product pool (A1 rule), or — for the
  // dollar coins whose only pool is StableSwap — the mid quote of that pool vs USDC
  // (`stableQuotePool`, estimate_swap both ways, ≥ 50 000 USD), which is also the
  // cross-check when Reflector is primary (founder decision 2026-10-15). Else null.
  | { kind: 'oracle'; fallbackEnvVar?: string; stableQuotePool?: string }
  // base asset price × the stable-pool mid quote (estimate_swap both ways) — the only
  // source for xSolvBTC (listed by no feed, no constant-product pool).
  | { kind: 'derived'; base: string; quotePool: string }
  | {
      // Explicit env override (MANUAL_<ASSET>_USD) when set; otherwise the asset is
      // priced on-chain like a `coingecko` asset without a key (price-sources v2,
      // 2026-09-29). No hard-coded fallback value exists any more: no source → null.
      kind: 'manual';
      envVar: string;
      confidence?: 'high' | 'medium' | 'low';
      note?: string;
    };

export const PRICING_RULES_BY_SYMBOL: Record<string, PricingRule> = {
  native: { kind: 'coingecko', id: 'stellar', fallbackEnvVar: 'MANUAL_XLM_USD' },
  USDC: { kind: 'stable', priceUsd: 1 },
  // PYUSD / yUSDC: Reflector Stellar DEX primary (phase B, no longer an assumed peg); their
  // only pools are StableSwap (no cp ratio) → the pool's mid quote is the fallback / control.
  PYUSD: { kind: 'oracle', stableQuotePool: 'aquarius-pyusd-usdc-pool' },
  // EURC: priced on-chain (Soroswap USDC/EURC, SDEX USDC/EURC + XLM/EURC) unless overridden.
  EURC: { kind: 'manual', envVar: 'MANUAL_EURC_USD' },
  // SolvBTC: Reflector Stellar DEX primary, aquarius-native-solvbtc-pool (two hops) as fallback / control.
  SolvBTC: { kind: 'oracle', fallbackEnvVar: 'MANUAL_SOLVBTC_USD' },
  // xSolvBTC: SolvBTC × the xSolvBTC/SolvBTC StableSwap mid (phase B) — single pool, two sources for the base.
  xSolvBTC: { kind: 'derived', base: 'SolvBTC', quotePool: 'aquarius-xsolvbtc-solvbtc-pool' },
  USTRY: { kind: 'coingecko', id: 'etherfuse-ustry', fallbackEnvVar: 'MANUAL_USTRY_USD' },
  // CETES: the CoinGecko `cetes` feed is dead (founder ruling 2026-08-16, Lot P);
  // the hard-coded 0.069 of that ruling is replaced by the live pool-implied price
  // of aquarius-cetes-usdc-pool within the standard guards (price-sources v2).
  CETES: {
    kind: 'manual',
    envVar: 'MANUAL_CETES_USD',
    confidence: 'low',
    note: 'CG feed dead since Lot P; on-chain pool-implied price',
  },
  TESOURO: { kind: 'coingecko', id: 'etherfuse-tesouro', fallbackEnvVar: 'MANUAL_TESOURO_USD' },
  // oUSD: Blend's own Orbit oracle hard-codes it at 1 (parity); no feed, no pool → single source, documented.
  oUSD: { kind: 'stable', priceUsd: 1, note: 'single-source: Blend Orbit oracle peg, parity' },
  // YieldBlox (blend-yieldblox-pool) reserve assets not already covered above.
  AQUA: { kind: 'coingecko', id: 'aquarius', fallbackEnvVar: 'MANUAL_AQUA_USD' },
  // USDGLO: Reflector Stellar DEX primary; its only pool is StableSwap → quote as fallback / control.
  USDGLO: { kind: 'oracle', fallbackEnvVar: 'MANUAL_USDGLO_USD', stableQuotePool: 'aquarius-usdglo-usdc-pool' },
  // Lot P (P0b, founder-approved top tier 2026-08-16). Proxy/peg rules carry the
  // same confidence:medium caveat as SolvBTC above — 1:1-redeemable wrappers whose
  // peg the venue's own price confirmed at vetting time (docs/evidence/lot-p/).
  // USDY: single source (aquarius-usdy-usdc cp pool; no feed lists it) → sanity band
  // [1.00, 1.25] + |Δ 24 h| ≤ 2 % (NAV token, 1.1338 on 2026-09-29). Founder asks Reflector to list it.
  USDY: {
    kind: 'coingecko',
    id: 'ondo-us-dollar-yield',
    fallbackEnvVar: 'MANUAL_USDY_USD',
    sanity: { minUsd: 1.0, maxUsd: 1.25, maxMove24hPct: 2 },
  },
  yXLM: { kind: 'proxy', base: 'XLM' },
  yUSDC: { kind: 'oracle', stableQuotePool: 'aquarius-usdc-yusdc-pool' },
  // BTC (Stellar wrapper): Reflector CEX primary; fallback / control = aquarius-btc-eth-pool
  // (two hops through this run's ETH/USD). The BTC/USDC clpool is discovery-only.
  BTC: { kind: 'oracle', fallbackEnvVar: 'MANUAL_BTC_USD' },
  ETH: { kind: 'coingecko', id: 'ethereum', fallbackEnvVar: 'MANUAL_ETH_USD' },
};
// Reflector "External CEXs & DEXs" tickers (Asset::Other) for the assets it prices in
// USD. USDC is read as a SANITY value only (the product keeps USDC = 1 by convention).
export const REFLECTOR_CEX_TICKERS: Record<string, string> = {
  native: 'XLM',
  BTC: 'BTC',
  ETH: 'ETH',
  EURC: 'EURC',
  USDC: 'USDC',
};
