import { loadJson, nowIso, saveJson } from './00-common';

function countBy<T extends string>(values: T[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const shape = await loadJson<any>('57-soroswap-active-pair-db-shape.json');
  const normalized = await loadJson<any>('58-soroswap-active-pair-events-normalized.json');

  if (!shape) throw new Error('Missing 57-soroswap-active-pair-db-shape.json');
  if (!normalized) throw new Error('Missing 58-soroswap-active-pair-events-normalized.json');

  const subEventKeys = (normalized.rows ?? []).map((row: any) => row.eventKey).filter(Boolean);

  const output = {
    generatedAt: nowIso(),
    venue: {
      slug: 'soroswap',
      name: 'Soroswap',
      chain: 'stellar-mainnet',
      venueType: 'amm',
    },
    pair: {
      entitySlug: shape.entitySlug,
      pairId: shape.pairId,
      name: shape.pairName,
      reserveCount: Array.isArray(shape.reserves) ? shape.reserves.length : 0,
      token0: shape.token0,
      token1: shape.token1,
      reservesRaw: shape.reserves,
    },
    assets: shape.assets,
    activity: {
      recentEventCount: normalized.count ?? 0,
      eventCounts: countBy(subEventKeys),
    },
  };

  console.dir(output, { depth: 8 });
  await saveJson('59-soroswap-final-registry.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});