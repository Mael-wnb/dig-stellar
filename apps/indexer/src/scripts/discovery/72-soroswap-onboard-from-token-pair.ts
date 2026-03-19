import { loadJson, saveJson, nowIso } from './00-common';

async function main() {
  const resolved = await loadJson<any>('71-soroswap-resolve-pair-from-token-pair.json');

  if (!resolved) {
    throw new Error('Missing 71-soroswap-resolve-pair-from-token-pair.json');
  }

  if (!resolved.resolvedPairId) {
    throw new Error('Could not resolve pairId from token pair');
  }

  const pairId = resolved.resolvedPairId as string;

  const nextCommands = [
    `SOROSWAP_PAIR_ID=${pairId} pnpm tsx src/scripts/discovery/55-soroswap-active-pair-probe.ts`,
    `SOROSWAP_PAIR_ID=${pairId} pnpm tsx src/scripts/discovery/50-soroswap-pair-events.ts`,
    `pnpm tsx src/scripts/discovery/56-soroswap-active-pair-assets-resolve.ts`,
    `pnpm tsx src/scripts/discovery/57-soroswap-active-pair-db-shape.ts`,
    `pnpm tsx src/scripts/discovery/58-soroswap-active-pair-events-normalized.ts`,
    `pnpm tsx src/scripts/discovery/59-soroswap-final-registry.ts`,
    `pnpm tsx src/scripts/bootstrap/soroswap-upsert-core.ts`,
    `pnpm tsx src/scripts/ingest/soroswap-insert-events.ts`,
    `pnpm tsx src/scripts/discovery/60-soroswap-pool-snapshot-db-ready.ts`,
    `pnpm tsx src/scripts/discovery/61-soroswap-reserve-snapshots-db-ready.ts`,
    `pnpm tsx src/scripts/ingest/soroswap-insert-snapshots.ts`,
    `pnpm tsx src/scripts/ingest/66-soroswap-pool-metrics-v1.ts`,
    `pnpm tsx src/scripts/ingest/69-soroswap-persist-pool-metrics.ts`,
    `pnpm tsx src/scripts/ingest/70-protocol-persist-metrics.ts`,
  ];

  const output = {
    generatedAt: nowIso(),
    protocol: 'soroswap',
    inputType: 'token_pair',
    tokenA: resolved.tokenA,
    tokenB: resolved.tokenB,
    pairId,
    status: 'resolved',
    nextCommands,
  };

  console.dir(output, { depth: 8 });
  await saveJson('72-soroswap-onboard-from-token-pair.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});