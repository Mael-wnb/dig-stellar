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
  
  type DecodedPoolValue = {
    caller?: string;
    token_in?: string;
    token_out?: string;
    token_amount_in?: bigint | string | number;
    token_amount_out?: bigint | string | number;
    [key: string]: unknown;
  };
  
  function toStringAmount(v: unknown): string | null {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number") return String(v);
    if (typeof v === "string" && /^[0-9]+$/.test(v)) return v;
    return null;
  }
  
  async function main() {
    const rpcUrl = getEnv("STELLAR_RPC_URL");
  
    const contractId =
      process.env.CONTRACT_ID ??
      "CAS3FL6TLZKDGGSISDBWGGPXT3NRR4DYTZD7YOD3HMYO6LTJUVGRVEAM";
  
    const latestLedgerResp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getLatestLedger");
    const latestLedger = latestLedgerResp.result?.sequence;
  
    if (!latestLedger) {
      throw new Error("Could not retrieve latest ledger");
    }
  
    const startLedger = Number(process.env.START_LEDGER ?? latestLedger - 5000);
    const limit = Number(process.env.EVENTS_LIMIT ?? 300);
  
    const resp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getEvents", {
      startLedger,
      filters: [{ contractIds: [contractId] }],
      pagination: { limit },
    });
  
    const events = resp.result?.events ?? [];
  
    const tokenCounts: Record<string, number> = {};
    const callerCounts: Record<string, number> = {};
    const eventCounts: Record<string, number> = {};
    const amountSamples: Array<{
      eventName: string;
      subEventName: string | null;
      token: string | null;
      caller: string | null;
      amountIn: string | null;
      amountOut: string | null;
      txHash: string;
      ledger: number;
    }> = [];
  
    for (const event of events) {
      const decodedTopics = decodeTopicList(event.topic ?? []);
      const decodedValue = decodeScValBase64(event.value) as DecodedPoolValue | null;
  
      const eventName = tryExtractEventName(decodedTopics) ?? "unknown";
      const subEventName = typeof decodedTopics[1] === "string" ? decodedTopics[1] : null;
  
      const key = `${eventName}:${subEventName ?? "unknown"}`;
      eventCounts[key] = (eventCounts[key] ?? 0) + 1;
  
      const token =
        typeof decodedValue?.token_in === "string"
          ? decodedValue.token_in
          : typeof decodedValue?.token_out === "string"
          ? decodedValue.token_out
          : null;
  
      const caller = typeof decodedValue?.caller === "string" ? decodedValue.caller : null;
      const amountIn = toStringAmount(decodedValue?.token_amount_in);
      const amountOut = toStringAmount(decodedValue?.token_amount_out);
  
      if (token) tokenCounts[token] = (tokenCounts[token] ?? 0) + 1;
      if (caller) callerCounts[caller] = (callerCounts[caller] ?? 0) + 1;
  
      if (amountSamples.length < 50) {
        amountSamples.push({
          eventName,
          subEventName,
          token,
          caller,
          amountIn,
          amountOut,
          txHash: event.txHash,
          ledger: event.ledger,
        });
      }
    }
  
    const output = {
      fetchedAt: nowIso(),
      contractId,
      latestLedger,
      startLedger,
      totalEvents: events.length,
      eventCounts,
      tokenCounts,
      callerCounts,
      amountSamples,
    };
  
    console.dir(
      {
        contractId,
        totalEvents: events.length,
        eventCounts,
        tokenCounts,
      },
      { depth: 8 }
    );
  
    await saveJson("16-blend-pool-token-summary.json", output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });