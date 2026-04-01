// apps/indexer/src/scripts/ingest/run-blend-pool-refresh.ts
import 'dotenv/config';

import { saveJson } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { fetchBlendPoolState } from '../../lib/protocols/blend/fetch-pool-state';
import { persistBlendPoolState } from '../../lib/protocols/blend/persist-pool-state';
import { persistBlendPoolMetrics } from '../../lib/protocols/blend/persist-pool-metrics';

async function main() {
  const poolId = process.env.BLEND_POOL_ID?.trim() ?? process.env.POOL_ID?.trim();
  const entitySlug = process.env.ENTITY_SLUG?.trim();
  const debug = process.env.DEBUG === '1' || process.env.BLEND_DEBUG === '1';

  if (!poolId) {
    throw new Error('Missing BLEND_POOL_ID');
  }

  if (!entitySlug) {
    throw new Error('Missing ENTITY_SLUG');
  }

  console.log('=== Blend pool refresh ===');
  console.log({ poolId, entitySlug, debug });

  const poolState = await fetchBlendPoolState({
    poolId,
    entitySlug,
    verbose: debug,
  });

  if (debug) {
    await saveJson('lib-blend-pool-state.json', poolState);
  }

  const client = createPgClient();
  await client.connect();

  try {
    const persistedState = await persistBlendPoolState({
      client,
      poolState,
      debug,
    });

    const persistedMetrics = await persistBlendPoolMetrics({
      client,
      entitySlug,
    });

    if (debug) {
      await saveJson('lib-blend-pool-metrics.json', persistedMetrics);
    }

    console.log(persistedState);
    console.log(persistedMetrics);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});