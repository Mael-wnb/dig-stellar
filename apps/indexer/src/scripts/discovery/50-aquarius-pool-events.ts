// src/scripts/discovery/50-aquarius-pool-events.ts
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
  
  type RpcEvent = {
    id: string;
    ledger: number;
    ledgerClosedAt: string;
    txHash: string;
    topic?: string[];
    value?: string;
  };
  
  type GetEventsResult = {
    events?: RpcEvent[];
    cursor?: string;
    latestLedger?: number | string;
    oldestLedger?: number | string;
    latestLedgerCloseTime?: string;
    oldestLedgerCloseTime?: string;
  };
  
  async function main() {
    const rpcUrl = process.env.SOROBAN_RPC_URL ?? getEnv('STELLAR_RPC_URL');
    const poolId = getEnv('AQUARIUS_POOL_ID');
  
    const latestLedgerResp = await rpcCall<RpcEnvelope<{ sequence: number | string }>>(rpcUrl, 'getLatestLedger');
    const latestLedger = Number(latestLedgerResp.result?.sequence);
  
    if (!Number.isFinite(latestLedger)) {
      throw new Error('Could not retrieve latest ledger');
    }
  
    const ledgerLookback = Number(process.env.LEDGER_LOOKBACK ?? 5000);
    const startLedger = Number(process.env.START_LEDGER ?? latestLedger - ledgerLookback);
    const limit = Number(process.env.EVENTS_LIMIT ?? 200);
    const maxPages = Number(process.env.MAX_EVENT_PAGES ?? 20);
  
    const allEvents: RpcEvent[] = [];
    let cursor: string | undefined;
    let pagesFetched = 0;
  
    let responseMeta: Partial<GetEventsResult> = {};
  
    while (pagesFetched < maxPages) {
      const params =
        pagesFetched === 0
          ? {
              startLedger,
              filters: [{ contractIds: [poolId] }],
              pagination: { limit },
            }
          : {
              filters: [{ contractIds: [poolId] }],
              pagination: { cursor, limit },
            };
  
      const resp = await rpcCall<RpcEnvelope<GetEventsResult>>(rpcUrl, 'getEvents', params);
  
      if (resp.error) {
        console.dir(resp.error, { depth: 8 });
        throw new Error(`getEvents returned error on page ${pagesFetched + 1}`);
      }
  
      const result = resp.result;
      if (!result) {
        throw new Error(`Missing result on getEvents page ${pagesFetched + 1}`);
      }
  
      const pageEvents = Array.isArray(result.events) ? result.events : [];
  
      if (pagesFetched === 0) {
        responseMeta = {
          latestLedger: result.latestLedger,
          oldestLedger: result.oldestLedger,
          latestLedgerCloseTime: result.latestLedgerCloseTime,
          oldestLedgerCloseTime: result.oldestLedgerCloseTime,
        };
      }
  
      allEvents.push(...pageEvents);
      pagesFetched += 1;
  
      const nextCursor = typeof result.cursor === 'string' ? result.cursor : undefined;
  
      console.log({
        page: pagesFetched,
        pageEvents: pageEvents.length,
        nextCursor,
        firstEventId: pageEvents[0]?.id ?? null,
        lastEventId: pageEvents[pageEvents.length - 1]?.id ?? null,
      });
  
      if (!nextCursor || pageEvents.length === 0) {
        break;
      }
  
      if (nextCursor === cursor) {
        console.log('Stopping pagination because cursor did not advance.');
        break;
      }
  
      cursor = nextCursor;
    }
  
    const decodedEvents = allEvents.map((event) => {
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
  
    const ledgers = decodedEvents
      .map((event) => Number(event.ledger))
      .filter((value) => Number.isFinite(value));
  
    const output = {
      generatedAt: nowIso(),
      poolId,
      latestLedger,
      startLedger,
      ledgerLookback,
      pagesFetched,
      cursor,
      count: decodedEvents.length,
      oldestLedger: ledgers.length ? Math.min(...ledgers) : null,
      newestLedger: ledgers.length ? Math.max(...ledgers) : null,
      firstDecodedEvent: decodedEvents[0] ?? null,
      lastDecodedEvent: decodedEvents[decodedEvents.length - 1] ?? null,
      topTopics,
      decodedEvents,
      rpcMeta: responseMeta,
    };
  
    console.dir(
      {
        poolId,
        latestLedger,
        startLedger,
        ledgerLookback,
        pagesFetched,
        count: decodedEvents.length,
        oldestLedger: output.oldestLedger,
        newestLedger: output.newestLedger,
        firstDecodedEvent: output.firstDecodedEvent,
        lastDecodedEvent: output.lastDecodedEvent,
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