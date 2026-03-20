import { loadJson, nowIso, saveJson } from './00-common';

async function main() {
  const shape = await loadJson<any>('57-aquarius-active-pool-db-shape.json');
  if (!shape) {
    throw new Error('Missing 57-aquarius-active-pool-db-shape.json');
  }

  const output = {
    generatedAt: nowIso(),
    venue: {
      slug: 'aquarius',
      name: 'Aquarius',
      chain: 'stellar-mainnet',
      venueType: 'amm',
    },
    pool: {
      entitySlug: shape.entitySlug,
      poolId: shape.poolId,
      name: shape.poolName,
      reserveCount: Array.isArray(shape.reserveRows) ? shape.reserveRows.length : 0,
      token0: shape.token0,
      token1: shape.token1,
      reservesRaw: shape.reserves ?? [],
      info: shape.info ?? null,
    },
    assets: shape.assets ?? [],
  };

  console.dir(output, { depth: 8 });
  await saveJson('59-aquarius-final-registry.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});