// apps/indexer/src/scripts/shared/pricing-config.ts
export type PricingRule =
  | { kind: 'coingecko'; id: string; fallbackEnvVar?: string }
  | { kind: 'stable'; priceUsd: number }
  | { kind: 'proxy'; base: 'BTC' | 'XLM' }
  | { kind: 'manual'; envVar: string; fallbackPriceUsd?: number };

export const PRICING_RULES_BY_SYMBOL: Record<string, PricingRule> = {
  native: { kind: 'coingecko', id: 'stellar', fallbackEnvVar: 'MANUAL_XLM_USD' },
  USDC: { kind: 'stable', priceUsd: 1 },
  PYUSD: { kind: 'stable', priceUsd: 1 },
  EURC: { kind: 'manual', envVar: 'MANUAL_EURC_USD', fallbackPriceUsd: 1.16 },
  SolvBTC: { kind: 'proxy', base: 'BTC' },
  xSolvBTC: { kind: 'proxy', base: 'BTC' },
  USTRY: { kind: 'coingecko', id: 'etherfuse-ustry', fallbackEnvVar: 'MANUAL_USTRY_USD' },
  CETES: { kind: 'coingecko', id: 'cetes', fallbackEnvVar: 'MANUAL_CETES_USD' },
  TESOURO: { kind: 'coingecko', id: 'etherfuse-tesouro', fallbackEnvVar: 'MANUAL_TESOURO_USD' },
  oUSD: { kind: 'stable', priceUsd: 1 },
};