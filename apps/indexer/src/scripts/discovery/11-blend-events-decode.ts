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
    const limit = Number(process.env.EVENTS_LIMIT ?? 100);
  
    const resp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getEvents", {
      startLedger,
      filters: [{ contractIds: [contractId] }],
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
        contractId: event.contractId,
        txHash: event.txHash,
        operationIndex: event.operationIndex,
        transactionIndex: event.transactionIndex,
        inSuccessfulContractCall: event.inSuccessfulContractCall,
        eventName,
        decodedTopics,
        decodedValue,
        rawTopic: event.topic,
        rawValue: event.value,
      };
    });
  
    const output = {
      fetchedAt: nowIso(),
      contractId,
      latestLedger,
      startLedger,
      count: decodedEvents.length,
      decodedEvents,
    };
  
    console.dir(
      {
        contractId,
        latestLedger,
        startLedger,
        count: decodedEvents.length,
        firstDecodedEvent: decodedEvents[0] ?? null,
      },
      { depth: 10 }
    );
  
    await saveJson("11-blend-events-decode.json", output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });