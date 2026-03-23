import {
    getEnv,
    rpcCall,
    saveJson,
    nowIso,
    loadJson,
    decodeTopicList,
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
  
    const blendData = await loadJson<any>("07-blend-discovery.json");
    const addresses: string[] = blendData?.addresses ?? [];
  
    if (!addresses.length) {
      throw new Error("No Blend addresses found in 07-blend-discovery.json");
    }
  
    const latestLedgerResp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getLatestLedger");
    const latestLedger = latestLedgerResp.result?.sequence;
  
    if (!latestLedger) {
      throw new Error("Could not retrieve latest ledger");
    }
  
    const startLedger = Number(process.env.START_LEDGER ?? latestLedger - 5000);
    const perContractLimit = Number(process.env.EVENTS_LIMIT ?? 100);
  
    const contracts: Array<{
      address: string;
      totalEvents: number;
      topicCounts: Record<string, number>;
      sampleEvents: unknown[];
    }> = [];
  
    for (const address of addresses) {
      const resp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getEvents", {
        startLedger,
        filters: [{ contractIds: [address] }],
        pagination: { limit: perContractLimit },
      });
  
      const events = resp.result?.events ?? [];
      const topicCounts: Record<string, number> = {};
  
      const sampleEvents = events.slice(0, 10).map((event: any) => {
        const decodedTopics = decodeTopicList(event.topic ?? []);
        const eventName = tryExtractEventName(decodedTopics) ?? "unknown";
  
        topicCounts[eventName] = (topicCounts[eventName] ?? 0) + 1;
  
        return {
          id: event.id,
          ledger: event.ledger,
          txHash: event.txHash,
          inSuccessfulContractCall: event.inSuccessfulContractCall,
          decodedTopics,
          rawValue: event.value,
        };
      });
  
      for (const event of events.slice(10)) {
        const decodedTopics = decodeTopicList(event.topic ?? []);
        const eventName = tryExtractEventName(decodedTopics) ?? "unknown";
        topicCounts[eventName] = (topicCounts[eventName] ?? 0) + 1;
      }
  
      contracts.push({
        address,
        totalEvents: events.length,
        topicCounts,
        sampleEvents,
      });
  
      console.log(address, topicCounts);
    }
  
    const output = {
      fetchedAt: nowIso(),
      latestLedger,
      startLedger,
      contracts,
    };
  
    await saveJson("10-blend-topic-inventory.json", output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });