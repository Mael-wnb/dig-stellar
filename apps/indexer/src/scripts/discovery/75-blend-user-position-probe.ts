// apps/indexer/src/scripts/discovery/75-blend-user-position-probe.ts
//
// De-risk BEFORE persisting (same hygiene as the bridge adapter). Runs the
// resolver READ path against a known mainnet wallet with a real Blend position
// and dumps:
//   - the per-asset collateral/supply/liability shape,
//   - the computed effective collateral/liabilities + HEALTH FACTOR,
//   - the precision/units of every amount (confirm the SDK Float helpers are
//     already decimal-scaled before trusting them in persist).
//
// Eyeball the printed health factor against blend.capital's UI for the address.
//
// Usage:
//   POOL_ID=<pool contract> USER_ADDRESS=<G...> \
//     pnpm -C apps/indexer exec tsx src/scripts/discovery/75-blend-user-position-probe.ts

import { nowIso, saveJson } from './00-common';
import { fetchBlendUserPositions } from '../../lib/protocols/blend/fetch-user-positions';
import { resolveBlendUserHealth } from '../../lib/protocols/blend/resolve-user-health';

async function main() {
  const poolId =
    process.env.POOL_ID ??
    process.env.BLEND_POOL_ID ??
    'CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPSXUTNXG'; // Blend v2 main pool

  const userAddress = process.env.USER_ADDRESS;
  if (!userAddress) {
    throw new Error(
      'Set USER_ADDRESS to a mainnet account with a real Blend position'
    );
  }

  const positions = await fetchBlendUserPositions({ poolId, userAddress });
  const health = resolveBlendUserHealth(positions);

  // Precision/units check: print raw SDK positions maps alongside the scaled
  // floats so we can confirm what units the SDK returns.
  const rawPositions = {
    collateral: Array.from(positions.user.positions.collateral.entries()),
    supply: Array.from(positions.user.positions.supply.entries()),
    liabilities: Array.from(positions.user.positions.liabilities.entries()),
  };

  console.dir(
    {
      generatedAt: nowIso(),
      poolId,
      userAddress,
      hasPosition: positions.hasPosition,
      reserveCount: positions.reserves.length,
      reserves: positions.reserves,
      health,
      rawPositions,
    },
    { depth: 8 }
  );

  await saveJson('75-blend-user-position-probe.json', {
    generatedAt: nowIso(),
    poolId,
    userAddress,
    reserves: positions.reserves,
    health,
    rawPositions: {
      collateral: rawPositions.collateral.map(([k, v]) => [k, v.toString()]),
      supply: rawPositions.supply.map(([k, v]) => [k, v.toString()]),
      liabilities: rawPositions.liabilities.map(([k, v]) => [k, v.toString()]),
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
