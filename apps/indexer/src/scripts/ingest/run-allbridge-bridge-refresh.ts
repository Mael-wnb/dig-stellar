// apps/indexer/src/scripts/ingest/run-allbridge-bridge-refresh.ts
import 'dotenv/config';

import { saveJson } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { ALLBRIDGE_BRIDGE_CONTRACT_ID } from '../../lib/protocols/allbridge/constants';
import { fetchAllbridgeBridgeEvents } from '../../lib/protocols/allbridge/fetch-bridge-events';
import { normalizeAllbridgeBridgeEvents } from '../../lib/protocols/allbridge/normalize-bridge-events';
import { persistAllbridgeBridgeFlows } from '../../lib/protocols/allbridge/persist-bridge-flows';

async function main() {
  const contractId = process.env.ALLBRIDGE_BRIDGE_ID ?? ALLBRIDGE_BRIDGE_CONTRACT_ID;

  console.log('=== Allbridge bridge flow refresh ===');
  console.log({ contractId });

  const bridgeEvents = await fetchAllbridgeBridgeEvents({
    contractId,
    verbose: process.env.VERBOSE === '1',
  });

  await saveJson('lib-allbridge-bridge-events.json', bridgeEvents);

  const normalized = normalizeAllbridgeBridgeEvents({ bridgeEvents, contractId });

  await saveJson('lib-allbridge-bridge-events-normalized.json', normalized);

  console.log({
    fetched: bridgeEvents.count,
    normalized: normalized.count,
    byDirection: normalized.eventCounts,
    topTopics: bridgeEvents.topTopics,
  });

  if (!normalized.rows.length) {
    console.log('No bridge flows in window — nothing to persist.');
    return;
  }

  const client = createPgClient();
  await client.connect();

  try {
    const persisted = await persistAllbridgeBridgeFlows({
      client,
      rows: normalized.rows,
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
