// src/mappers/poolMapper.ts

import type {
  PoolDetailData,
  PoolReserveDetail,
  PoolTokenSummary,
} from '../types/protocol'

import type { PoolDisplay } from '../types/poolDisplay'

/* ──────────────────────────────────────────────── */
/* SAFE HELPERS */
/* ──────────────────────────────────────────────── */

function n(value: any): number | null {
  if (value === null || value === undefined) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/* ──────────────────────────────────────────────── */
/* MAIN MAPPER */
/* ──────────────────────────────────────────────── */

export function mapPoolToDisplay(data: PoolDetailData): PoolDisplay {
  return {
    id: data.id,
    name: data.name,
    type: data.type,
    chain: data.chain,
    contractAddress: data.contractAddress,
    updatedAt: data.updatedAt,

    /* ───────────────────────── */
    /* METRICS (CRITICAL FIX) */
    /* ───────────────────────── */

    metrics: {
      // COMMON
      tvlUsd: n(data.metrics?.tvlUsd),

      // AMM
      volume24hUsd: n(data.metrics?.volume24hUsd),
      fees24hUsd: n(data.metrics?.fees24hUsd),
      swaps24h: n(data.metrics?.swaps24h ?? data.metrics?.events24h),

      // LENDING
      totalSuppliedUsd: n(data.metrics?.totalSuppliedUsd),
      totalBorrowedUsd: n(data.metrics?.totalBorrowedUsd),
      netLiquidityUsd: n(data.metrics?.netLiquidityUsd),
      totalBackstopCreditUsd: n(data.metrics?.totalBackstopCreditUsd),

      supplyApy: n(data.metrics?.supplyApy),
      borrowApy: n(data.metrics?.borrowApy),
    },

    /* ───────────────────────── */
    /* LENDING RESERVES */
    /* ───────────────────────── */

    reserves: (data.reserves ?? []).map((r): PoolReserveDetail => ({
      assetId: r.assetId,
      symbol: r.symbol,
      name: r.name,

      priceUsd: n(r.priceUsd),

      supplied: n(r.supplied),
      borrowed: n(r.borrowed),

      backstopCredit: n(r.backstopCredit),
      supplyCap: n(r.supplyCap),

      supplyApy: n(r.supplyApy),
      borrowApy: n(r.borrowApy),
    })),

    /* ───────────────────────── */
    /* AMM TOKENS */
    /* ───────────────────────── */

    tokens: (data.tokens ?? []).map((t): PoolTokenSummary => ({
      assetId: t.assetId,
      symbol: t.symbol,
      role: t.role,
    })),
  }
}