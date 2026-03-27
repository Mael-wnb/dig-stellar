import 'dotenv/config';

import { saveJson, nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { fetchSoroswapPairState } from '../../lib/protocols/soroswap/fetch-pair-state';
import { fetchSoroswapPairEvents } from '../../lib/protocols/soroswap/fetch-pair-events';
import { normalizeSoroswapPairEvents } from '../../lib/protocols/soroswap/normalize-pair-events';
import { persistSoroswapPairEvents } from '../../lib/protocols/soroswap/persist-pair-events';

async function main() {
  const pairId = process.env.SOROSWAP_PAIR_ID;
  const entitySlug = process.env.ENTITY_SLUG;

  if (!pairId) {
    throw new Error('Missing SOROSWAP_PAIR_ID');
  }

  if (!entitySlug) {
    throw new Error('Missing ENTITY_SLUG');
  }

  console.log('=== Soroswap pair refresh ===');
  console.log({ pairId, entitySlug });

  const pairState = await fetchSoroswapPairState({
    pairId,
    entitySlug,
    verbose: true,
  });

  await saveJson('lib-soroswap-pair-state.json', {
    generatedAt: nowIso(),
    ...pairState,
  });

  const pairEvents = await fetchSoroswapPairEvents({
    pairId,
    verbose: false,
  });

  await saveJson('lib-soroswap-pair-events.json', {
    generatedAt: nowIso(),
    ...pairEvents,
  });

  const normalized = normalizeSoroswapPairEvents({
    pairState,
    pairEvents,
  });

  await saveJson('lib-soroswap-pair-events-normalized.json', {
    generatedAt: nowIso(),
    ...normalized,
  });

  const client = createPgClient();
  await client.connect();

  try {
    const persisted = await persistSoroswapPairEvents({
      client,
      entitySlug,
      expectedPairId: pairId,
      rows: normalized.rows,
    });

    console.log({
      completedAt: nowIso(),
      ...persisted,
      eventCounts: normalized.eventCounts,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});