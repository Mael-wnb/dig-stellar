// apps/indexer/src/scripts/shared/xlm-price.ts
//
// XLM/USD price selection (hotfix 2026-09-29: keyless CoinGecko access is blocked
// from datacenter IPs). Pure functions only — no I/O — so the rule is unit-tested
// with node:test (see xlm-price.test.ts). The DB reads live in xlm-price-db.ts.
//
// Order of precedence:
//   1. manual override (MANUAL_XLM_USD / XLM_USD_FALLBACK) — explicit, traced as such;
//   2. CoinGecko when it answered;
//   3. the DEEPEST on-chain XLM/USDC constant-product pool that passes the guards;
//   4. none → null. A null is the honest answer; no constant is ever used silently.
//
// This price is used for DISPLAY and USD VALUATION only (asset_prices,
// network_stats_latest). It never feeds an execution path: action builders take
// their quotes from the venue contracts, and the faucet witness prices from
// asset_prices with its own 24h max age (apps/api witness.service.ts).

export const XLM_ONCHAIN_MAX_AGE_MS = 60 * 60 * 1000; // reserves older than 60 min are not a price
export const XLM_ONCHAIN_MIN_USDC_RESERVE = 50_000; // thinner pools are not a price
export const XLM_REFERENCE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // deviation guard only vs a < 6h CoinGecko reference
export const XLM_MAX_DEVIATION = 0.1; // 10 %

export type XlmOnchainCandidate = {
  /** asset_prices.source value, e.g. 'onchain_sdex_xlm_usdc' */
  source: string;
  /** entity slug of the pool the reserves came from */
  pool: string;
  xlmReserve: number;
  usdcReserve: number;
  observedAt: Date;
};

export type XlmReference = { priceUsd: number; observedAt: Date };

export type XlmPriceSelection = {
  priceUsd: number | null;
  /** asset_prices.source for the native row; 'none' when nothing qualified */
  source: string;
  /** 'manual' | 'coingecko' | 'onchain' | 'none' — the short label for logs/metadata */
  kind: 'manual' | 'coingecko' | 'onchain' | 'none';
  metadata: Record<string, unknown>;
};

export type XlmPriceInputs = {
  now: Date;
  manualOverride: number | null;
  coingecko: number | null;
  /** latest CoinGecko-sourced native row, for the deviation guard */
  reference: XlmReference | null;
  onchain: XlmOnchainCandidate[];
};

export function poolImpliedXlmUsd(candidate: XlmOnchainCandidate): number | null {
  if (!(candidate.xlmReserve > 0) || !(candidate.usdcReserve > 0)) return null;
  const price = candidate.usdcReserve / candidate.xlmReserve; // USDC assumed 1.00
  return Number.isFinite(price) ? price : null;
}

export type CandidateVerdict = {
  candidate: XlmOnchainCandidate;
  priceUsd: number | null;
  rejected: string | null;
};

export function judgeCandidate(
  candidate: XlmOnchainCandidate,
  now: Date,
  reference: XlmReference | null
): CandidateVerdict {
  const ageMs = now.getTime() - candidate.observedAt.getTime();
  if (!(ageMs <= XLM_ONCHAIN_MAX_AGE_MS)) {
    return { candidate, priceUsd: null, rejected: `stale reserves (${Math.round(ageMs / 60000)} min)` };
  }
  if (!(candidate.usdcReserve >= XLM_ONCHAIN_MIN_USDC_RESERVE)) {
    return {
      candidate,
      priceUsd: null,
      rejected: `thin pool (${Math.round(candidate.usdcReserve)} USDC < ${XLM_ONCHAIN_MIN_USDC_RESERVE})`,
    };
  }
  const priceUsd = poolImpliedXlmUsd(candidate);
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

export function selectXlmPrice(inputs: XlmPriceInputs): XlmPriceSelection {
  const { now, manualOverride, coingecko, reference, onchain } = inputs;

  if (manualOverride !== null && Number.isFinite(manualOverride) && manualOverride > 0) {
    return {
      priceUsd: manualOverride,
      source: 'manual_env',
      kind: 'manual',
      metadata: { confidence: 'medium', method: 'manual_override_env', envVar: 'MANUAL_XLM_USD|XLM_USD_FALLBACK' },
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

  // Deepest pool first (by USDC reserve); the first one passing every guard wins.
  const verdicts = [...onchain]
    .sort((a, b) => b.usdcReserve - a.usdcReserve)
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
        method: 'pool_implied_xlm_usdc',
        pool: c.pool,
        xlmReserve: c.xlmReserve,
        usdcReserve: c.usdcReserve,
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
