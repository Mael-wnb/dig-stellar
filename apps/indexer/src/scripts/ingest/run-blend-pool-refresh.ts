// apps/indexer/src/scripts/ingest/run-blend-pool-refresh.ts
import 'dotenv/config';

import { saveJson } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { computeBlendPoolMetrics } from '../../lib/protocols/blend/compute-pool-metrics';
import { persistBlendPoolMetrics } from '../../lib/protocols/blend/persist-pool-metrics';

async function main() {
  const entitySlug = process.env.ENTITY_SLUG?.trim();
  const debug = process.env.SAVE_DEBUG_JSON === '1';

  if (!entitySlug) {
    throw new Error('Missing ENTITY_SLUG');
  }

  console.log('=== Blend pool refresh ===');
  console.log({ entitySlug, debug });

  const client = createPgClient();
  await client.connect();

  try {
    const computed = await computeBlendPoolMetrics({
      client,
      entitySlug,
    });

    if (debug) {
      await saveJson('lib-blend-pool-metrics.json', computed);
    }

    const persisted = await persistBlendPoolMetrics({
      client,
      entitySlug,
    });

    console.log(persisted);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});