// apps/indexer/src/lib/protocols/blend/fetch-user-positions.ts
//
// Resolve a single user's Blend position in a single pool, using the SAME pool /
// RPC / oracle setup as fetch-pool-state.ts. Reads are SDK-native:
//   - PoolV2.load    → reserves
//   - pool.loadOracle → the pool's Reflector oracle (USD prices, on-chain parity)
//   - pool.loadUser   → the user's collateral / supply / liability positions
//
// We return the per-asset breakdown PLUS the raw SDK objects (pool, oracle, user)
// so resolve-user-health.ts can hand them straight to PositionsEstimate.build —
// the health factor must come from the SDK's estimate, never a hand-rolled
// collateral/liability-factor formula.

import 'dotenv/config';

import { Networks } from '@stellar/stellar-sdk';
import { PoolOracle, PoolUser, PoolV2 } from '@blend-capital/blend-sdk';
import { resolveRpcUrl } from '../../rpc-config';

export type BlendUserReservePosition = {
  assetId: string; // reserve asset contract address
  decimals: number;
  priceUsd: number | null; // oracle (Reflector) price, USD float
  // amounts in asset units (the SDK Float helpers are already decimal-scaled)
  collateral: number; // collateralized supply
  supply: number; // non-collateral supply
  liabilities: number; // borrow
  collateralUsd: number | null;
  supplyUsd: number | null;
  liabilitiesUsd: number | null;
};

export type BlendUserPositions = {
  poolId: string;
  userAddress: string;
  hasPosition: boolean;
  reserves: BlendUserReservePosition[];
  // Raw SDK objects retained for the health estimate (resolve-user-health).
  pool: PoolV2;
  oracle: PoolOracle;
  user: PoolUser;
};

export async function fetchBlendUserPositions(params: {
  poolId: string;
  userAddress: string;
  rpcUrl?: string;
}): Promise<BlendUserPositions> {
  const rpcUrl = resolveRpcUrl(params.rpcUrl);
  const network = {
    passphrase: Networks.PUBLIC,
    rpc: rpcUrl,
  };

  const pool = await PoolV2.load(network, params.poolId);
  const oracle = await pool.loadOracle();
  const user = await pool.loadUser(params.userAddress);

  const reserves: BlendUserReservePosition[] = [];
  let hasPosition = false;

  for (const [assetId, reserve] of pool.reserves.entries()) {
    // Float helpers return human-scaled asset units (SDK applies decimals/bRate/
    // dRate internally) — no manual scaling, which is what bit us on the bridge.
    const collateral = user.getCollateralFloat(reserve);
    const supply = user.getSupplyFloat(reserve);
    const liabilities = user.getLiabilitiesFloat(reserve);

    if (collateral === 0 && supply === 0 && liabilities === 0) {
      continue;
    }

    hasPosition = true;

    const priceUsd = oracle.getPriceFloat(assetId) ?? null;

    reserves.push({
      assetId,
      decimals: reserve.config.decimals,
      priceUsd,
      collateral,
      supply,
      liabilities,
      collateralUsd: priceUsd !== null ? collateral * priceUsd : null,
      supplyUsd: priceUsd !== null ? supply * priceUsd : null,
      liabilitiesUsd: priceUsd !== null ? liabilities * priceUsd : null,
    });
  }

  return {
    poolId: params.poolId,
    userAddress: params.userAddress,
    hasPosition,
    reserves,
    pool,
    oracle,
    user,
  };
}
