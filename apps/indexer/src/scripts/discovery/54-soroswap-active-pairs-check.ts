import {
    getEnv,
    loadJson,
    rpcCall,
    saveJson,
    nowIso,
  } from "./00-common";
  
  type RpcEnvelope<T> = {
    jsonrpc: "2.0";
    id: string;
    result?: T;
    error?: unknown;
  };
  
  async function main() {
    const rpcUrl = getEnv("STELLAR_RPC_URL");
    const pairsFile = await loadJson<any>("53-soroswap-factory-pairs-scan.json");
    if (!pairsFile) throw new Error("Missing 53-soroswap-factory-pairs-scan.json");
  
    const pairIds = (pairsFile.results ?? [])
      .map((r: any) => r.pairId)
      .filter((v: any) => typeof v === "string");
  
    const latestLedgerResp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getLatestLedger");
    const latestLedger = latestLedgerResp.result?.sequence;
    if (!latestLedger) throw new Error("Could not retrieve latest ledger");
  
    const startLedger = Number(process.env.START_LEDGER ?? latestLedger - 10000);
    const limit = Number(process.env.EVENTS_LIMIT ?? 20);
  
    const results = [];
  
    for (const pairId of pairIds) {
      const resp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getEvents", {
        startLedger,
        filters: [{ contractIds: [pairId] }],
        pagination: { limit },
      });
  
      const events = resp.result?.events ?? [];
  
      results.push({
        pairId,
        count: events.length,
        firstEvent: events[0] ?? null,
      });
  
      console.log(pairId, "=>", events.length);
    }
  
    await saveJson("54-soroswap-active-pairs-check.json", {
      generatedAt: nowIso(),
      latestLedger,
      startLedger,
      results,
    });
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });