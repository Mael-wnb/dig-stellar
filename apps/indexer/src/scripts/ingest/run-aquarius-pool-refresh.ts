// apps/indexer/src/scripts/ingest/run-aquarius-pool-refresh.ts
import 'dotenv/config';

import { saveJson } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { fetchAquariusPoolState } from '../../lib/protocols/aquarius/fetch-pool-state';
import { fetchAquariusPoolEvents } from '../../lib/protocols/aquarius/fetch-pool-events';
import { normalizeAquariusPoolEvents } from '../../lib/protocols/aquarius/normalize-pool-events';
import { persistAquariusPoolEvents } from '../../lib/protocols/aquarius/persist-pool-events';
import { persistAquariusPoolMetrics } from '../../lib/protocols/aquarius/persist-pool-metrics';

async function main() {
  const poolId = process.env.AQUARIUS_POOL_ID?.trim();
  const entitySlug = process.env.ENTITY_SLUG?.trim();
  const debug = process.env.SAVE_DEBUG_JSON === '1';

  if (!poolId) {
    throw new Error('Missing AQUARIUS_POOL_ID');
  }

  if (!entitySlug) {
    throw new Error('Missing ENTITY_SLUG');
  }

  console.log('=== Aquarius pool refresh ===');
  console.log({ poolId, entitySlug, debug });

  const poolState = await fetchAquariusPoolState({
    poolId,
    entitySlug,
    verbose: true,
  });

  if (debug) {
    await saveJson('lib-aquarius-pool-state.json', poolState);
  }

  const poolEvents = await fetchAquariusPoolEvents({
    poolId,
    verbose: false,
  });

  if (debug) {
    await saveJson('lib-aquarius-pool-events.json', poolEvents);
  }

  const normalized = normalizeAquariusPoolEvents({
    poolState,
    poolEvents,
  });

  if (debug) {
    await saveJson('lib-aquarius-pool-events-normalized.json', normalized);
  }

  const client = createPgClient();
  await client.connect();

  try {
    const persistedEvents = await persistAquariusPoolEvents({
      client,
      entitySlug,
      expectedPoolId: poolId,
      rows: normalized.rows,
    });

    const persistedMetrics = await persistAquariusPoolMetrics({
      client,
      entitySlug,
      expectedPoolId: poolId,
    });

    console.log({
      ...persistedEvents,
      eventCounts: normalized.eventCounts,
    });
    console.log(persistedMetrics);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});