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
  
  function flattenUnknown(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value.flatMap(flattenUnknown);
    }
  
    if (value && typeof value === "object") {
      return Object.values(value as Record<string, unknown>).flatMap(flattenUnknown);
    }
  
    return [value];
  }
  
  function extractStrings(value: unknown): string[] {
    return flattenUnknown(value).filter((v): v is string => typeof v === "string");
  }
  
  function extractBigintsLike(value: unknown): string[] {
    return flattenUnknown(value)
      .filter(
        (v) =>
          typeof v === "bigint" ||
          typeof v === "number" ||
          (typeof v === "string" && /^[0-9]+$/.test(v))
      )
      .map((v) => String(v));
  }
  
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
  
    const normalized = events.map((event: any) => {
      const decodedTopics = decodeTopicList(event.topic ?? []);
      const decodedValue = decodeScValBase64(event.value);
      const eventName = tryExtractEventName(decodedTopics) ?? "unknown";
  
      const userLikeAddresses = [
        ...extractStrings(decodedTopics),
        ...extractStrings(decodedValue),
      ].filter((s) => /^[CG][A-Z2-7]{20,120}$/.test(s));
  
      const amountLikeValues = extractBigintsLike(decodedValue);
  
      return {
        source: "soroban_rpc",
        contractId: event.contractId,
        txHash: event.txHash,
        ledger: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt,
        eventName,
        inSuccessfulContractCall: event.inSuccessfulContractCall,
        userLikeAddresses: Array.from(new Set(userLikeAddresses)),
        amountLikeValues,
        decodedTopics,
        decodedValue,
      };
    });
  
    const output = {
      fetchedAt: nowIso(),
      contractId,
      latestLedger,
      startLedger,
      count: normalized.length,
      normalized,
    };
  
    console.dir(
      {
        contractId,
        count: normalized.length,
        firstNormalized: normalized[0] ?? null,
      },
      { depth: 10 }
    );
  
    await saveJson("12-blend-events-normalized.json", output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });