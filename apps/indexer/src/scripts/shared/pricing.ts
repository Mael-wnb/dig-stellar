export type PriceConfidence = 'high' | 'medium' | 'low';

export type PriceInsert = {
  assetId: string;
  priceUsd: number;
  source: string;
  observedAt: string;
  metadata?: Record<string, unknown>;
};

export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function safeDivide(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

export function inferStablePrice(symbol: string): number | null {
  const s = symbol.toUpperCase();

  if (s === 'USDC') return 1;
  if (s === 'USDX') return 1;

  return null;
}

export function inferFiatLinkedPrice(symbol: string, eurUsd: number): number | null {
  const s = symbol.toUpperCase();

  if (s === 'EURC') return eurUsd;

  return null;
}