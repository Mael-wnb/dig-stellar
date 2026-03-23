import {
    getEnv,
    rpcCall,
    saveJson,
    nowIso,
    decodeTopicList,
    decodeScValBase64,
    tryExtractEventName,
  } from "./00-common";
  
  type RpcEnvelope<T> = {
    jsonrpc: "2.0";
    id: string;
    result?: T;
    error?: unknown;
  };
  
  async function main() {
    const rpcUrl = getEnv("STELLAR_RPC_URL");
  
    const contractId =
      process.env.CONTRACT_ID ??
      "CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7";
  
    const latestLedgerResp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getLatestLedger");
    const latestLedger = latestLedgerResp.result?.sequence;
  
    if (!latestLedger) {
      throw new Error("Could not retrieve latest ledger");
    }
  
    const startLedger = Number(process.env.START_LEDGER ?? latestLedger - 5000);
    const limit = Number(process.env.EVENTS_LIMIT ?? 200);
  
    const resp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getEvents", {
      startLedger,
      filters: [{ contractIds: [contractId] }],
      pagination: { limit },
    });
  
    const events = resp.result?.events ?? [];
  
    const byType: Record<
      string,
      {
        count: number;
        sample: unknown | null;
      }
    > = {};
  
    for (const event of events) {
      const decodedTopics = decodeTopicList(event.topic ?? []);
      const decodedValue = decodeScValBase64(event.value);
      const eventName = tryExtractEventName(decodedTopics) ?? "unknown";
  
      if (!byType[eventName]) {
        byType[eventName] = {
          count: 0,
          sample: {
            id: event.id,
            ledger: event.ledger,
            ledgerClosedAt: event.ledgerClosedAt,
            txHash: event.txHash,
            inSuccessfulContractCall: event.inSuccessfulContractCall,
            decodedTopics,
            decodedValue,
            rawTopic: event.topic,
            rawValue: event.value,
          },
        };
      }
  
      byType[eventName].count += 1;
    }
  
    const output = {
      fetchedAt: nowIso(),
      contractId,
      latestLedger,
      startLedger,
      totalEvents: events.length,
      byType,
    };
  
    console.dir(
      {
        contractId,
        totalEvents: events.length,
        eventTypes: Object.fromEntries(
          Object.entries(byType).map(([k, v]) => [k, v.count])
        ),
      },
      { depth: 8 }
    );
  
    await saveJson("13-blend-event-samples-by-type.json", output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });