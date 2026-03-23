import { loadJson, nowIso, saveJson } from './00-common';

async function main() {
  const shape = await loadJson<any>('57-aquarius-active-pool-db-shape.json');
  if (!shape) {
    throw new Error('Missing 57-aquarius-active-pool-db-shape.json');
  }

  const reserveCount = Array.isArray(shape.reserveRows) ? shape.reserveRows.length : 0;
  const info = shape.info ?? {};
  const feeBps =
    typeof info.fee === 'number'
      ? info.fee
      : typeof info.fee === 'string' && !Number.isNaN(Number(info.fee))
        ? Number(info.fee)
        : null;

  const output = {
    generatedAt: nowIso(),
    venueSlug: 'aquarius',
    entitySlug: shape.entitySlug,
    entityType: 'amm_pool',
    poolId: shape.poolId,
    poolName: shape.poolName,
    reserveCount,
    totalEvents: 0,
    totalDeposits: 0,
    totalSwaps: 0,
    totalExitPool: 0,
    uniqueCallers: null,
    metadata: {
      source: '57-aquarius-active-pool-db-shape',
      poolType: info.pool_type ?? null,
      feeBps,
      reservesRaw: shape.reserves ?? [],
    },
  };

  console.dir(output, { depth: 8 });
  await saveJson('60-aquarius-pool-snapshot-db-ready.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});