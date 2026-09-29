// apps/indexer/src/scripts/shared/pricing-config.ts
export type PricingRule =
  | { kind: 'coingecko'; id: string; fallbackEnvVar?: string }
  | { kind: 'stable'; priceUsd: number }
  | { kind: 'proxy'; base: 'BTC' | 'XLM' }
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
  PYUSD: { kind: 'stable', priceUsd: 1 },
  // EURC: priced on-chain (Soroswap USDC/EURC, SDEX USDC/EURC + XLM/EURC) unless overridden.
  EURC: { kind: 'manual', envVar: 'MANUAL_EURC_USD' },
  SolvBTC: { kind: 'proxy', base: 'BTC' },
  xSolvBTC: { kind: 'proxy', base: 'BTC' },
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
  oUSD: { kind: 'stable', priceUsd: 1 },
  // YieldBlox (blend-yieldblox-pool) reserve assets not already covered above.
  AQUA: { kind: 'coingecko', id: 'aquarius', fallbackEnvVar: 'MANUAL_AQUA_USD' },
  USDGLO: { kind: 'coingecko', id: 'glo-dollar', fallbackEnvVar: 'MANUAL_USDGLO_USD' },
  // Lot P (P0b, founder-approved top tier 2026-08-16). Proxy/peg rules carry the
  // same confidence:medium caveat as SolvBTC above — 1:1-redeemable wrappers whose
  // peg the venue's own price confirmed at vetting time (docs/evidence/lot-p/).
  USDY: { kind: 'coingecko', id: 'ondo-us-dollar-yield', fallbackEnvVar: 'MANUAL_USDY_USD' },
  yXLM: { kind: 'proxy', base: 'XLM' },
  yUSDC: { kind: 'stable', priceUsd: 1 },
  BTC: { kind: 'proxy', base: 'BTC' },
  ETH: { kind: 'coingecko', id: 'ethereum', fallbackEnvVar: 'MANUAL_ETH_USD' },
};