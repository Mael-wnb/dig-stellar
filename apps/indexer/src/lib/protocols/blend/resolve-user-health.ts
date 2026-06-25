// apps/indexer/src/lib/protocols/blend/resolve-user-health.ts
//
// Compute the per-(wallet, pool) Blend risk summary — effective collateral,
// effective liabilities, and the HEALTH FACTOR — from the SDK's positions
// estimate. We deliberately do NOT hand-roll Blend's collateral/liability-factor
// math: precision or factor bugs here become wrong liquidation alerts in D2.
//
// PositionsEstimate values are expressed in the pool's oracle denomination. For
// the indexed Blend mainnet pools that denomination is USD (Reflector USD feed),
// so we surface them as *_usd. If a pool with a non-USD oracle is ever indexed,
// revisit this labelling.

import { PositionsEstimate } from '@blend-capital/blend-sdk';
import type { BlendUserPositions } from './fetch-user-positions';

export type BlendUserHealth = {
  // health_factor = effective_collateral / effective_liabilities.
  // NULL when the user has no debt (no liabilities → ratio undefined, not
  // liquidatable). HF > 1 healthy; HF <= 1 liquidatable.
  healthFactor: number | null;
  totalCollateralUsd: number; // effective collateral (after collateral factors)
  totalDebtUsd: number; // effective liabilities (after liability factors)
  totalSuppliedUsd: number; // raw supplied value (pre-factor)
  totalBorrowedUsd: number; // raw borrowed value (pre-factor)
  borrowCapUsd: number; // remaining borrow capacity
  borrowLimit: number; // ratio of liabilities to collateral (0..1)
  netApy: number;
};

export function resolveBlendUserHealth(
  positions: BlendUserPositions
): BlendUserHealth {
  const estimate = PositionsEstimate.build(
    positions.pool,
    positions.oracle,
    positions.user.positions
  );

  const totalDebtUsd = estimate.totalEffectiveLiabilities;
  const totalCollateralUsd = estimate.totalEffectiveCollateral;

  // No debt → HF undefined (division by zero). Store NULL, never Infinity or a
  // sentinel — D2 treats NULL as "no liability, no health alert applicable".
  const healthFactor =
    totalDebtUsd > 0 ? totalCollateralUsd / totalDebtUsd : null;

  return {
    healthFactor,
    totalCollateralUsd,
    totalDebtUsd,
    totalSuppliedUsd: estimate.totalSupplied,
    totalBorrowedUsd: estimate.totalBorrowed,
    borrowCapUsd: estimate.borrowCap,
    borrowLimit: estimate.borrowLimit,
    netApy: estimate.netApy,
  };
}
