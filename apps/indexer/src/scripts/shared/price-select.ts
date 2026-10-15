// apps/indexer/src/scripts/shared/price-select.ts
//
// Multi-source selection for step 1 (price-sources v2, phase B — the lightweight
// production rule, founder decision 2026-10-14):
//   1. Reflector is the PRIMARY source for every asset it covers (CEX feed for
//      XLM / BTC / ETH / EURC, Stellar DEX feed for the Stellar tokens), fresh ≤ 900 s.
//   2. The A1 rule (deepest constant-product pool vs USDC / XLM / ETH within guards,
//      or CoinGecko with a key, or a manual env override) is the FALLBACK when
//      Reflector is absent, and the CROSS-CHECK when Reflector is primary:
//      tolerance 1 % (dollar / NAV coins) or 3 % (XLM, BTC, ETH, SolvBTC, xSolvBTC,
//      EURC, AQUA). On disagreement the primary is KEPT, the disagreement is traced
//      in metadata.crossCheck and surfaced on #status — never averaged.
//   3. A sanity band (USDY: [1.00, 1.25] and |Δ 24 h| ≤ 2 %) turns an out-of-band
//      value into "no price" (A2's null), with the reason logged.
// Pure functions only; the reads live in reflector.ts / xlm-price-db.ts.
import type { OracleRead } from './reflector';
import type { PoolQuoteRead } from './pool-quote';

// One resolved price (any source). Structurally a superset of XlmPriceSelection.
export type Resolution = {
  priceUsd: number | null;
  source: string;
  kind: string;
  metadata: Record<string, unknown>;
};

export const WIDE_TOLERANCE_SYMBOLS = new Set(['native', 'BTC', 'ETH', 'SolvBTC', 'xSolvBTC', 'EURC', 'AQUA']);

export function crossCheckTolerancePct(symbol: string): number {
  return WIDE_TOLERANCE_SYMBOLS.has(symbol) ? 3 : 1;
}

export type CrossCheck = {
  secondarySource: string;
  secondaryPriceUsd: number;
  deviationPct: number; // signed, primary vs secondary, in %
  tolerancePct: number;
  agrees: boolean;
};

export function crossCheck(
  symbol: string,
  primaryPriceUsd: number,
  secondary: { source: string; priceUsd: number | null } | null
): CrossCheck | null {
  if (!secondary || secondary.priceUsd === null || !(secondary.priceUsd > 0)) return null;
  const tolerancePct = crossCheckTolerancePct(symbol);
  const deviationPct = ((primaryPriceUsd - secondary.priceUsd) / secondary.priceUsd) * 100;
  return {
    secondarySource: secondary.source,
    secondaryPriceUsd: secondary.priceUsd,
    deviationPct: Number(deviationPct.toFixed(4)),
    tolerancePct,
    agrees: Math.abs(deviationPct) <= tolerancePct,
  };
}

export type SanityBand = { minUsd: number; maxUsd: number; maxMove24hPct: number };

export type PreviousPrice = { priceUsd: number; observedAt: Date };

/** Out-of-band → the price is dropped for this run (null), with an explicit reason. */
export function applySanityBand(
  priceUsd: number,
  band: SanityBand | undefined,
  previous: PreviousPrice | null,
  now: Date
): { ok: boolean; reason: string | null } {
  if (!band) return { ok: true, reason: null };
  if (priceUsd < band.minUsd || priceUsd > band.maxUsd) {
    return { ok: false, reason: `out of band [${band.minUsd}, ${band.maxUsd}]: ${priceUsd}` };
  }
  if (previous && previous.priceUsd > 0) {
    const ageH = (now.getTime() - previous.observedAt.getTime()) / 3_600_000;
    if (ageH <= 36) {
      const movePct = Math.abs((priceUsd - previous.priceUsd) / previous.priceUsd) * 100;
      if (movePct > band.maxMove24hPct) {
        return { ok: false, reason: `moved ${movePct.toFixed(2)} % vs ${previous.priceUsd} (${ageH.toFixed(1)} h ago) > ${band.maxMove24hPct} %` };
      }
    }
  }
  return { ok: true, reason: null };
}


/**
 * Combine the Reflector read (primary when fresh) with the A1 selection
 * (fallback / cross-check). `sourcesQualified` counts independent market sources
 * that produced a price this run — the #status "single-source" counter reads it.
 */
export function combineSources(params: {
  symbol: string;
  reflector: { read: OracleRead; source: string } | null;
  fallback: Resolution;
}): Resolution {
  const { symbol, reflector, fallback } = params;
  const fallbackPrice = fallback.priceUsd !== null && fallback.priceUsd > 0 ? fallback.priceUsd : null;
  const reflectorMeta = reflector
    ? reflector.read.ok
      ? { source: reflector.source, priceUsd: reflector.read.price.priceUsd, observedAt: reflector.read.price.observedAt.toISOString(), ageSec: reflector.read.price.ageSec }
      : { source: reflector.source, absent: reflector.read.reason }
    : null;

  // A manual env override stays first (explicit operator decision, traced as such).
  if (fallback.kind === 'manual' && fallbackPrice !== null) {
    return { ...fallback, metadata: { ...fallback.metadata, reflector: reflectorMeta, sourcesQualified: 1 } };
  }

  if (reflector && reflector.read.ok) {
    const primary = reflector.read.price.priceUsd;
    const check = crossCheck(symbol, primary, fallbackPrice !== null ? { source: fallback.source, priceUsd: fallbackPrice } : null);
    return {
      priceUsd: primary,
      source: reflector.source,
      kind: 'reflector',
      metadata: {
        confidence: check === null ? 'medium' : check.agrees ? 'high' : 'medium',
        method: 'reflector_primary',
        reflector: reflectorMeta,
        crossCheck: check,
        fallback: { source: fallback.source, priceUsd: fallbackPrice, rejected: fallback.metadata.rejected ?? [] },
        sourcesQualified: 1 + (fallbackPrice !== null ? 1 : 0),
      },
    };
  }

  // Reflector absent (not listed, stale or unreadable) → the A1 selection stands alone.
  return {
    ...fallback,
    metadata: {
      ...fallback.metadata,
      reflector: reflectorMeta,
      crossCheck: null,
      // a proxy (yXLM = XLM) inherits its upstream's count; anything else stands alone
      sourcesQualified:
        fallbackPrice !== null ? (typeof fallback.metadata.sourcesQualified === 'number' ? fallback.metadata.sourcesQualified : 1) : 0,
    },
  };
}

/**
 * The StableSwap mid quote of an asset's pool vs USDC as a Resolution (founder
 * decision 2026-10-15: fallback when Reflector is absent, cross-check when it is
 * primary — USDGLO, PYUSD, yUSDC). A failed read or a thin pool yields a null
 * resolution with the reason, so the caller never falls back on it.
 */
export function stableQuoteResolution(params: {
  symbol: string;
  pool: string; // entity slug, e.g. aquarius-usdglo-usdc-pool
  quoteSymbol: string; // 'USDC'
  quote: PoolQuoteRead;
  quoteUsd: number;
}): Resolution {
  const { symbol, pool, quoteSymbol, quote, quoteUsd } = params;
  const venue = pool.split('-')[0] || 'pool';
  const source = `quote_${venue}_${symbol === 'native' ? 'xlm' : symbol.toLowerCase()}_${quoteSymbol.toLowerCase()}`;
  if (!quote.ok) {
    return { priceUsd: null, source: 'none', kind: 'none', metadata: { method: 'no_qualifying_source', rejected: [{ pool, reason: `quote: ${quote.reason}` }] } };
  }
  const q = quote.quote;
  if (!q.deepEnough) {
    return {
      priceUsd: null,
      source: 'none',
      kind: 'none',
      metadata: { method: 'no_qualifying_source', rejected: [{ pool, reason: `thin pool (${Math.round(q.quoteReserveUsd)} USD on the ${quoteSymbol} side < 50000)` }] },
    };
  }
  return {
    priceUsd: q.priceInQuote * quoteUsd,
    source,
    kind: 'quote',
    metadata: {
      confidence: 'medium',
      method: 'stable_pool_mid_quote',
      pool,
      quoteMethod: q.method,
      quoteReserveUsd: q.quoteReserveUsd,
      assetReserve: q.assetReserve,
      feeBps: q.feeBps,
      rejected: [],
    },
  };
}

/** First fallback with a price wins; rejections of the others are kept in the trace. */
export function mergeFallbacks(primary: Resolution, ...others: Array<Resolution | null>): Resolution {
  const all = [primary, ...others.filter((r): r is Resolution => r !== null)];
  const winner = all.find((r) => r.priceUsd !== null && r.priceUsd > 0);
  const rejected = all.flatMap((r) => (r.priceUsd === null ? ((r.metadata.rejected as unknown[] | undefined) ?? []) : []));
  if (winner) {
    return { ...winner, metadata: { ...winner.metadata, rejected: [...((winner.metadata.rejected as unknown[] | undefined) ?? []), ...rejected] } };
  }
  return { ...primary, metadata: { ...primary.metadata, rejected } };
}

/** `price source:` log line suffix describing the cross-check outcome. */
export function describeCrossCheck(check: CrossCheck | null | undefined): string {
  if (!check) return '';
  const sign = check.deviationPct >= 0 ? '+' : '';
  return check.agrees
    ? ` [cross-check ${check.secondarySource} ${check.secondaryPriceUsd} ${sign}${check.deviationPct.toFixed(2)} % ok]`
    : ` — DISAGREES with ${check.secondarySource} ${check.secondaryPriceUsd} (${sign}${check.deviationPct.toFixed(2)} % > ${check.tolerancePct} %), primary kept`;
}
