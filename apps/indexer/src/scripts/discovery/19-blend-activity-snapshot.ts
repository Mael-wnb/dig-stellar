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
  
  function getSubEventName(decodedTopics: unknown[]): string | null {
    return typeof decodedTopics[1] === "string" ? decodedTopics[1] : null;
  }
  
  type DecodedPoolValue = {
    caller?: string;
    token_in?: string;
    token_out?: string;
    token_amount_in?: bigint | string | number;
    token_amount_out?: bigint | string | number;
    [key: string]: unknown;
  };
  
  function toStr(v: unknown): string | null {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number") return String(v);
    if (typeof v === "string") return v;
    return null;
  }
  
  async function main() {
    const rpcUrl = getEnv("STELLAR_RPC_URL");
    const contractId =
      process.env.CONTRACT_ID ??
      "CAS3FL6TLZKDGGSISDBWGGPXT3NRR4DYTZD7YOD3HMYO6LTJUVGRVEAM";
  
    const latestLedgerResp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getLatestLedger");
    const latestLedger = latestLedgerResp.result?.sequence;
    if (!latestLedger) throw new Error("Could not retrieve latest ledger");
  
    const startLedger = Number(process.env.START_LEDGER ?? latestLedger - 5000);
    const limit = Number(process.env.EVENTS_LIMIT ?? 300);
  
    const resp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getEvents", {
      startLedger,
      filters: [{ contractIds: [contractId] }],
      pagination: { limit },
    });
  
    const events = resp.result?.events ?? [];
  
    const uniqueCallers = new Set<string>();
    const eventCounts: Record<string, number> = {};
    const tokenFlows: Record<string, { count: number; amountInSamples: string[] }> = {};
  
    for (const event of events) {
      const decodedTopics = decodeTopicList(event.topic ?? []);
      const decodedValue = decodeScValBase64(event.value) as DecodedPoolValue | null;
  
      const eventName = tryExtractEventName(decodedTopics) ?? "unknown";
      const subEventName = getSubEventName(decodedTopics) ?? "unknown";
      const key = `${eventName}:${subEventName}`;
  
      eventCounts[key] = (eventCounts[key] ?? 0) + 1;
  
      const caller = typeof decodedValue?.caller === "string" ? decodedValue.caller : null;
      if (caller) uniqueCallers.add(caller);
  
      const token =
        typeof decodedValue?.token_in === "string"
          ? decodedValue.token_in
          : typeof decodedValue?.token_out === "string"
          ? decodedValue.token_out
          : null;
  
      const amountIn = toStr(decodedValue?.token_amount_in);
  
      if (token) {
        if (!tokenFlows[token]) {
          tokenFlows[token] = { count: 0, amountInSamples: [] };
        }
        tokenFlows[token].count += 1;
        if (amountIn && tokenFlows[token].amountInSamples.length < 20) {
          tokenFlows[token].amountInSamples.push(amountIn);
        }
      }
    }
  
    const snapshot = {
      generatedAt: nowIso(),
      venue: "blend",
      entityType: "pool",
      entityId: contractId,
      startLedger,
      latestLedger,
      totalEvents: events.length,
      uniqueCallers: uniqueCallers.size,
      eventCounts,
      tokenFlows,
    };
  
    console.dir(snapshot, { depth: 8 });
    await saveJson("19-blend-activity-snapshot.json", snapshot);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
  