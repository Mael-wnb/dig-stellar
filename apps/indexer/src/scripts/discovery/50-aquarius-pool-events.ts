import {
    getEnv,
    rpcCall,
    saveJson,
    nowIso,
    decodeTopicList,
    decodeScValBase64,
    tryExtractEventName,
  } from './00-common';
  import 'dotenv/config';
  
  type RpcEnvelope<T> = {
    jsonrpc: '2.0';
    id: string;
    result?: T;
    error?: unknown;
  };
  
  async function main() {
    const rpcUrl = process.env.SOROBAN_RPC_URL ?? getEnv('STELLAR_RPC_URL');
    const poolId = getEnv('AQUARIUS_POOL_ID');
  
    const latestLedgerResp = await rpcCall<RpcEnvelope<any>>(rpcUrl, 'getLatestLedger');
    const latestLedger = Number(latestLedgerResp.result?.sequence);
  
    if (!Number.isFinite(latestLedger)) {
      throw new Error('Could not retrieve latest ledger');
    }
  
    const startLedger = Number(process.env.START_LEDGER ?? latestLedger - 5000);
    const limit = Number(process.env.EVENTS_LIMIT ?? 200);
  
    const resp = await rpcCall<RpcEnvelope<any>>(rpcUrl, 'getEvents', {
      startLedger,
      filters: [{ contractIds: [poolId] }],
      pagination: { limit },
    });
  
    const events = resp.result?.events ?? [];
  
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
  
    const topicStats = new Map<string, number>();
  
    for (const event of decodedEvents) {
      const key = Array.isArray(event.decodedTopics)
        ? event.decodedTopics.map((v: unknown) => String(v)).join(' | ')
        : 'unknown';
  
      topicStats.set(key, (topicStats.get(key) ?? 0) + 1);
    }
  
    const topTopics = Array.from(topicStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([topicKey, count]) => ({ topicKey, count }));
  
    const output = {
      generatedAt: nowIso(),
      poolId,
      latestLedger,
      startLedger,
      count: decodedEvents.length,
      decodedEvents,
      topTopics,
    };
  
    console.dir(
      {
        poolId,
        latestLedger,
        startLedger,
        count: decodedEvents.length,
        firstDecodedEvent: decodedEvents[0] ?? null,
        topTopics,
      },
      { depth: 8 }
    );
  
    await saveJson('50-aquarius-pool-events.json', output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });