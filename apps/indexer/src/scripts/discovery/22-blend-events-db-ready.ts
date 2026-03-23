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
  
  function toStringOrNull(v: unknown): string | null {
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
  
    const rows = events.map((event: any) => {
      const decodedTopics = decodeTopicList(event.topic ?? []);
      const decodedValue = decodeScValBase64(event.value) as DecodedPoolValue | null;
  
      const eventName = tryExtractEventName(decodedTopics) ?? "unknown";
      const subEventName = getSubEventName(decodedTopics);
      const eventKey = `${eventName}:${subEventName ?? "unknown"}`;
  
      return {
        source: "soroban_rpc",
        venueSlug: "blend",
        entitySlug: "blend-primary-pool",
        contractAddress: event.contractId,
        eventId: event.id,
        txHash: event.txHash,
        ledger: event.ledger,
        occurredAt: event.ledgerClosedAt,
        eventName,
        subEventName,
        eventKey,
        inSuccessfulContractCall: event.inSuccessfulContractCall,
        callerAddress:
          typeof decodedValue?.caller === "string" ? decodedValue.caller : null,
        tokenIn:
          typeof decodedValue?.token_in === "string" ? decodedValue.token_in : null,
        tokenOut:
          typeof decodedValue?.token_out === "string" ? decodedValue.token_out : null,
        tokenAmountIn: toStringOrNull(decodedValue?.token_amount_in),
        tokenAmountOut: toStringOrNull(decodedValue?.token_amount_out),
        decodedTopics,
        decodedValue,
      };
    });
  
    const output = {
      generatedAt: nowIso(),
      contractId,
      latestLedger,
      startLedger,
      count: rows.length,
      rows,
    };
  
    console.dir(
      {
        contractId,
        count: rows.length,
        firstRow: rows[0] ?? null,
      },
      { depth: 8 }
    );
  
    await saveJson("22-blend-events-db-ready.json", output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });