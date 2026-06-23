// apps/indexer/src/scripts/discovery/74-allbridge-bridge-probe.ts
//
// De-risk the Allbridge adapter before committing to the parser: pull recent
// events off the bridge contract, print the raw topic + decoded value shape,
// and (for one TokensReceived) show the resolved source_chain_id + the full
// receive_tokens arg list so the §2 attribution path can be eyeballed.
//
//   pnpm -C apps/indexer exec tsx src/scripts/discovery/74-allbridge-bridge-probe.ts
import 'dotenv/config';

import { nowIso, saveJson } from './00-common';
import { ALLBRIDGE_BRIDGE_CONTRACT_ID } from '../../lib/protocols/allbridge/constants';
import { fetchAllbridgeBridgeEvents } from '../../lib/protocols/allbridge/fetch-bridge-events';

async function main() {
  const contractId = process.env.ALLBRIDGE_BRIDGE_ID ?? ALLBRIDGE_BRIDGE_CONTRACT_ID;

  const result = await fetchAllbridgeBridgeEvents({
    contractId,
    verbose: true,
  });

  const inflowSample = result.decodedEvents.find((e) => e.eventName === 'TokensReceived') ?? null;
  const outflowSample = result.decodedEvents.find((e) => e.eventName === 'TokensSent') ?? null;

  console.dir(
    {
      generatedAt: nowIso(),
      contractId,
      latestLedger: result.latestLedger,
      startLedger: result.startLedger,
      ledgerLookback: result.ledgerLookback,
      count: result.count,
      topTopics: result.topTopics,
      inflowSample: inflowSample && {
        eventName: inflowSample.eventName,
        decodedTopics: inflowSample.decodedTopics,
        decodedValue: inflowSample.decodedValue,
        sourceChainId: inflowSample.sourceChainId,
        invocationArgs: inflowSample.invocationArgs,
        txHash: inflowSample.txHash,
      },
      outflowSample: outflowSample && {
        eventName: outflowSample.eventName,
        decodedTopics: outflowSample.decodedTopics,
        decodedValue: outflowSample.decodedValue,
        txHash: outflowSample.txHash,
      },
    },
    { depth: 8 }
  );

  await saveJson('74-allbridge-bridge-probe.json', result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
