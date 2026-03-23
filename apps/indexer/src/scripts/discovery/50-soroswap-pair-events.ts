import 'dotenv/config';

import {
  getEnv,
  rpcCall,
  saveJson,
  nowIso,
  decodeTopicList,
  decodeScValBase64,
  tryExtractEventName,
} from './00-common';

type RpcEnvelope<T> = {
  jsonrpc: '2.0';
  id: string;
  result?: T;
  error?: unknown;
};

function resolveRpcUrl(): string {
  return process.env.SOROBAN_RPC_URL ?? getEnv('STELLAR_RPC_URL');
}

async function main() {
  const rpcUrl = resolveRpcUrl();
  const pairId = getEnv('SOROSWAP_PAIR_ID');

  const latestLedgerResp = await rpcCall<RpcEnvelope<any>>(rpcUrl, 'getLatestLedger');
  const latestLedger = latestLedgerResp.result?.sequence;

  if (!latestLedger) {
    throw new Error('Could not retrieve latest ledger');
  }

  const startLedger = Number(process.env.START_LEDGER ?? latestLedger - 5000);
  const limit = Number(process.env.EVENTS_LIMIT ?? 100);

  const resp = await rpcCall<RpcEnvelope<any>>(rpcUrl, 'getEvents', {
    startLedger,
    filters: [{ contractIds: [pairId] }],
    pagination: { limit },
  });

  if (resp.error) {
    throw new Error(
      `RPC getEvents failed for pair ${pairId}: ${
        typeof resp.error === 'string' ? resp.error : JSON.stringify(resp.error)
      }`
    );
  }

  const events = Array.isArray(resp.result?.events) ? resp.result.events : [];

  const decodedEvents = events.map((event: any) => {
    const decodedTopics = decodeTopicList(event.topic ?? []);
    const decodedValue = decodeScValBase64(event.value);
    const eventName = tryExtractEventName(decodedTopics);

    return {
      id: event.id,
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt,
      txHash: event.txHash,
      eventName,
      decodedTopics,
      decodedValue,
      rawTopic: event.topic,
      rawValue: event.value,
    };
  });

  const output = {
    generatedAt: nowIso(),
    pairId,
    latestLedger,
    startLedger,
    count: decodedEvents.length,
    decodedEvents,
  };

  console.dir(
    {
      pairId,
      latestLedger,
      startLedger,
      count: decodedEvents.length,
      firstDecodedEvent: decodedEvents[0] ?? null,
    },
    { depth: 8 }
  );

  await saveJson('50-soroswap-pair-events.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});