import { loadJson, nowIso, saveJson } from './00-common';

async function main() {
  const registry = await loadJson<any>('59-soroswap-final-registry.json');

  if (!registry) {
    throw new Error('Missing 59-soroswap-final-registry.json');
  }

  const eventCounts = registry.activity?.eventCounts ?? {};

  const output = {
    generatedAt: nowIso(),
    venueSlug: 'soroswap',
    entitySlug: registry.pair.entitySlug,
    entityType: 'amm_pool',
    poolId: registry.pair.pairId,
    poolName: registry.pair.name,
    reserveCount: registry.pair.reserveCount,
    totalEvents: registry.activity?.recentEventCount ?? 0,
    totalDeposits: eventCounts['SoroswapPair:deposit'] ?? 0,
    totalSwaps: eventCounts['SoroswapPair:swap'] ?? 0,
    totalExitPool: eventCounts['SoroswapPair:exit_pool'] ?? 0,
    uniqueCallers: null,
    metadata: {
      eventCounts,
      reservesRaw: registry.pair.reservesRaw,
    },
  };

  console.dir(output, { depth: 8 });
  await saveJson('60-soroswap-pool-snapshot-db-ready.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});