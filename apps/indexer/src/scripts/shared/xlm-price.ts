// apps/indexer/src/scripts/shared/xlm-price.ts
//
// Price selection for ANY priced asset (price-sources v2, 2026-09-29; born as the XLM
// hotfix e982fb2 — the XLM entry points are kept as thin wrappers). Pure functions
// only — no I/O — unit-tested with node:test (xlm-price.test.ts). DB reads live in
// xlm-price-db.ts.
//
// Order of precedence, per asset:
//   1. manual override (MANUAL_<ASSET>_USD env) — explicit, traced as such;
//   2. CoinGecko when it was called (only with a configured key) and answered;
//   3. the DEEPEST on-chain constant-product pool quoting the asset against USDC
//      (direct) or against XLM (two hops, via the XLM/USD resolved earlier in the
//      same run) that passes the guards;
//   4. none → null. A null is the honest answer; no constant is ever used silently.
//
// Guards (identical for every asset): reserves ≤ 60 min old, quote side ≥ 50 000 USD,
// and ≤ 10 % deviation vs a CoinGecko reference younger than 6 h when one exists.
// Without CoinGecko there is no reference, so freshness and liquidity are the only
// protections (phase B makes Reflector the reference).
//
// These prices serve DISPLAY and USD VALUATION only (asset_prices, network stats,
// wallet snapshots). They never feed an execution path: action builders take their
// quotes from the venue contracts; the faucet witness prices from asset_prices with
// its own 24h max age (apps/api witness.service.ts).

export const XLM_ONCHAIN_MAX_AGE_MS = 60 * 60 * 1000; // reserves older than 60 min are not a price
export const XLM_ONCHAIN_MIN_USDC_RESERVE = 50_000; // thinner pools are not a price
export const XLM_REFERENCE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // deviation guard only vs a < 6h CoinGecko reference
export const XLM_MAX_DEVIATION = 0.1; // 10 %

export type QuoteKind = 'usdc' | 'xlm';

export type OnchainCandidate = {
  /** asset_prices.source value, e.g. 'onchain_aquarius_ustry_usdc' */
  source: string;
  /** entity slug of the pool the reserves came from */
  pool: string;
  /** reserve of the asset being priced */
  assetReserve: number;
  /** the other leg, expressed in USD (USDC ×1, or XLM × the XLM/USD of this run) */
  quoteReserveUsd: number;
  quoteKind: QuoteKind;
  /** 1 = direct vs USDC, 2 = via XLM */
  hops: 1 | 2;
  observedAt: Date;
};

/** XLM-specific shape kept for the hotfix call sites and tests (maps onto OnchainCandidate). */
export type XlmOnchainCandidate = {
  source: string;
  pool: string;
  xlmReserve: number;
  usdcReserve: number;
  observedAt: Date;
};

export function xlmCandidateToGeneric(c: XlmOnchainCandidate): OnchainCandidate {
  return {
    source: c.source,
    pool: c.pool,
    assetReserve: c.xlmReserve,
    quoteReserveUsd: c.usdcReserve,
    quoteKind: 'usdc',
    hops: 1,
    observedAt: c.observedAt,
  };
}

export type XlmReference = { priceUsd: number; observedAt: Date };

export type XlmPriceSelection = {
  priceUsd: number | null;
  /** asset_prices.source for the native row; 'none' when nothing qualified */
  source: string;
  /** 'manual' | 'coingecko' | 'onchain' | 'none' — the short label for logs/metadata */
  kind: 'manual' | 'coingecko' | 'onchain' | 'none';
  metadata: Record<string, unknown>;
};

export type PriceInputs = {
  /** symbol being priced (for source/metadata labels) */
  asset: string;
  now: Date;
  manualOverride: number | null;
  /** MANUAL_<ASSET>_USD name, for tracing */
  manualEnvVar: string;
  coingecko: number | null;
  /** latest CoinGecko-sourced row of this asset, for the deviation guard */
  reference: XlmReference | null;
  onchain: OnchainCandidate[];
};

export type XlmPriceInputs = {
  now: Date;
  manualOverride: number | null;
  coingecko: number | null;
  reference: XlmReference | null;
  onchain: XlmOnchainCandidate[];
};

export function poolImpliedPriceUsd(candidate: OnchainCandidate): number | null {
  if (!(candidate.assetReserve > 0) || !(candidate.quoteReserveUsd > 0)) return null;
  const price = candidate.quoteReserveUsd / candidate.assetReserve;
  return Number.isFinite(price) ? price : null;
}

/** XLM wrapper kept for the hotfix call sites. */
export function poolImpliedXlmUsd(candidate: XlmOnchainCandidate): number | null {
  return poolImpliedPriceUsd(xlmCandidateToGeneric(candidate));
}

export type CandidateVerdict = {
  candidate: OnchainCandidate;
  priceUsd: number | null;
  rejected: string | null;
};

export function judgeCandidate(
  candidate: OnchainCandidate,
  now: Date,
  reference: XlmReference | null
): CandidateVerdict {
  const ageMs = now.getTime() - candidate.observedAt.getTime();
  if (!(ageMs <= XLM_ONCHAIN_MAX_AGE_MS)) {
    return { candidate, priceUsd: null, rejected: `stale reserves (${Math.round(ageMs / 60000)} min)` };
  }
  if (!(candidate.quoteReserveUsd >= XLM_ONCHAIN_MIN_USDC_RESERVE)) {
    return {
      candidate,
      priceUsd: null,
      rejected: `thin pool (${Math.round(candidate.quoteReserveUsd)} USD on the ${candidate.quoteKind} side < ${XLM_ONCHAIN_MIN_USDC_RESERVE})`,
    };
  }
  const priceUsd = poolImpliedPriceUsd(candidate);
  if (priceUsd === null) {
    return { candidate, priceUsd: null, rejected: 'non-positive reserves' };
  }
  if (reference && now.getTime() - reference.observedAt.getTime() <= XLM_REFERENCE_MAX_AGE_MS) {
    const deviation = Math.abs(priceUsd - reference.priceUsd) / reference.priceUsd;
    if (!(deviation <= XLM_MAX_DEVIATION)) {
      return {
        candidate,
        priceUsd: null,
        rejected: `deviation ${(deviation * 100).toFixed(1)}% vs CoinGecko reference ${reference.priceUsd}`,
      };
    }
  }
  return { candidate, priceUsd, rejected: null };
}

export function selectPrice(inputs: PriceInputs): XlmPriceSelection {
  const { now, manualOverride, manualEnvVar, coingecko, reference, onchain } = inputs;

  if (manualOverride !== null && Number.isFinite(manualOverride) && manualOverride > 0) {
    return {
      priceUsd: manualOverride,
      source: 'manual_env',
      kind: 'manual',
      metadata: { confidence: 'medium', method: 'manual_override_env', envVar: manualEnvVar },
    };
  }

  if (coingecko !== null && Number.isFinite(coingecko) && coingecko > 0) {
    return {
      priceUsd: coingecko,
      source: 'coingecko_direct',
      kind: 'coingecko',
      metadata: { confidence: 'high', method: 'direct_native_price' },
    };
  }

  // Deepest pool first (by the USD value of the quote side); the first one passing
  // every guard wins, whatever the quote kind.
  const verdicts = [...onchain]
    .sort((a, b) => b.quoteReserveUsd - a.quoteReserveUsd)
    .map((c) => judgeCandidate(c, now, reference));
  const winner = verdicts.find((v) => v.priceUsd !== null);
  const rejected = verdicts
    .filter((v) => v.rejected !== null)
    .map((v) => ({ pool: v.candidate.pool, reason: v.rejected }));

  if (winner && winner.priceUsd !== null) {
    const c = winner.candidate;
    return {
      priceUsd: winner.priceUsd,
      source: c.source,
      kind: 'onchain',
      metadata: {
        confidence: 'medium',
        method: c.hops === 1 ? 'pool_implied_vs_usdc' : 'pool_implied_vs_xlm',
        pool: c.pool,
        quoteKind: c.quoteKind,
        hops: c.hops,
        assetReserve: c.assetReserve,
        quoteReserveUsd: c.quoteReserveUsd,
        reservesObservedAt: c.observedAt.toISOString(),
        referenceUsed: reference
          ? { priceUsd: reference.priceUsd, observedAt: reference.observedAt.toISOString() }
          : null,
        rejected,
      },
    };
  }

  return {
    priceUsd: null,
    source: 'none',
    kind: 'none',
    metadata: { method: 'no_qualifying_source', coingecko: coingecko === null ? 'failed' : 'invalid', rejected },
  };
}

/** XLM entry point kept for the hotfix call sites (step 1 / step 9) and the existing tests. */
export function selectXlmPrice(inputs: XlmPriceInputs): XlmPriceSelection {
  return selectPrice({
    asset: 'native',
    now: inputs.now,
    manualOverride: inputs.manualOverride,
    manualEnvVar: 'MANUAL_XLM_USD|XLM_USD_FALLBACK',
    coingecko: inputs.coingecko,
    reference: inputs.reference,
    onchain: inputs.onchain.map(xlmCandidateToGeneric),
  });
}

// ── Candidates from the pools the refresh already captured ───────────────────
// A "reserve set" is one pool's latest reserves (two legs for the pools we price
// from). Only constant-product pools reach here (the loader excludes concentrated
// pools). A candidate exists when the pool pairs the asset with USDC (direct) or
// with XLM (two hops, needs this run's XLM/USD). Anything else (e.g. xSolvBTC/SolvBTC)
// is not a candidate: three hops are excluded.
export type PoolReserveSet = {
  pool: string;
  venue: 'aquarius' | 'soroswap' | 'sdex';
  observedAt: Date;
  reserves: Array<{ symbol: string; amount: number }>;
};

const sourceLabel = (symbol: string) => (symbol === 'native' ? 'xlm' : symbol.toLowerCase());

export function candidatesFromPools(
  symbol: string,
  sets: PoolReserveSet[],
  xlmUsd: number | null
): OnchainCandidate[] {
  const out: OnchainCandidate[] = [];
  for (const set of sets) {
    if (set.reserves.length !== 2) continue;
    const mine = set.reserves.find((r) => r.symbol === symbol);
    const other = set.reserves.find((r) => r.symbol !== symbol);
    if (!mine || !other) continue;
    if (other.symbol === 'USDC') {
      out.push({
        source: `onchain_${set.venue}_${sourceLabel(symbol)}_usdc`,
        pool: set.pool,
        assetReserve: mine.amount,
        quoteReserveUsd: other.amount, // USDC assumed 1.00
        quoteKind: 'usdc',
        hops: 1,
        observedAt: set.observedAt,
      });
    } else if (other.symbol === 'native' && symbol !== 'native' && xlmUsd !== null && xlmUsd > 0) {
      out.push({
        source: `onchain_${set.venue}_${sourceLabel(symbol)}_xlm`,
        pool: set.pool,
        assetReserve: mine.amount,
        quoteReserveUsd: other.amount * xlmUsd,
        quoteKind: 'xlm',
        hops: 2,
        observedAt: set.observedAt,
      });
    }
  }
  return out;
}

// ── Step 2 (Soroswap-derived) candidate ──────────────────────────────────────
// Builds the candidate step 2 must judge with the SAME guards as step 1: the
// unpriced leg of a Soroswap pair, quoted by the priced leg. Only a USDC or XLM
// quote is accepted (anything else would be a third hop). Returns null when the
// pair cannot be a candidate. Step 2 additionally never prices an asset that has a
// pricing-config rule — step 1 owns those, including their rejections.
export function pairCandidate(params: {
  pool: string;
  targetSymbol: string;
  targetReserve: number;
  quoteSymbol: string;
  quoteReserve: number;
  quotePriceUsd: number;
  observedAt: Date;
}): OnchainCandidate | null {
  const { pool, targetSymbol, targetReserve, quoteSymbol, quoteReserve, quotePriceUsd, observedAt } = params;
  if (quoteSymbol !== 'USDC' && quoteSymbol !== 'native') return null;
  if (!(quotePriceUsd > 0)) return null;
  const quoteKind: QuoteKind = quoteSymbol === 'USDC' ? 'usdc' : 'xlm';
  return {
    source: `onchain_soroswap_${sourceLabel(targetSymbol)}_${quoteKind}`,
    pool,
    assetReserve: targetReserve,
    quoteReserveUsd: quoteReserve * quotePriceUsd,
    quoteKind,
    hops: quoteKind === 'usdc' ? 1 : 2,
    observedAt,
  };
}

// 24h change from stored history: latest price vs the row nearest to now − 24h,
// accepted only within ± 30 min of that instant. Sources may differ (e.g. a
// CoinGecko point 24h ago vs an on-chain point now); the caller records both.
export const XLM_CHANGE_WINDOW_MS = 30 * 60 * 1000;

export type PricePoint = { priceUsd: number; observedAt: Date; source: string };

export function compute24hChangePct(
  latest: PricePoint | null,
  history: PricePoint[],
  now: Date
): { changePct: number | null; basis: PricePoint | null } {
  if (!latest || !(latest.priceUsd > 0)) return { changePct: null, basis: null };
  const target = now.getTime() - 24 * 60 * 60 * 1000;
  let best: PricePoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const p of history) {
    if (!(p.priceUsd > 0)) continue;
    const d = Math.abs(p.observedAt.getTime() - target);
    if (d < bestDistance) {
      best = p;
      bestDistance = d;
    }
  }
  if (!best || bestDistance > XLM_CHANGE_WINDOW_MS) return { changePct: null, basis: null };
  return { changePct: ((latest.priceUsd - best.priceUsd) / best.priceUsd) * 100, basis: best };
}
