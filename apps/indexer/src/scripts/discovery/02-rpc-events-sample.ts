import { getEnv, rpcCall, saveJson, nowIso } from "./00-common";

type RpcEnvelope<T> = {
  jsonrpc: "2.0";
  id: string;
  result?: T;
  error?: unknown;
};

async function main() {
  const rpcUrl = getEnv("STELLAR_RPC_URL");
  const limit = Number(process.env.EVENTS_LIMIT ?? 50);

  const latestLedgerResp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getLatestLedger");
  const latestLedger = latestLedgerResp.result?.sequence;

  if (!latestLedger) {
    throw new Error("Could not retrieve latest ledger");
  }

  const startLedger = Number(process.env.START_LEDGER ?? latestLedger - 2000);

  const contractIds = (process.env.CONTRACT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const params: Record<string, unknown> = {
    startLedger,
    pagination: { limit },
  };

  if (contractIds.length > 0) {
    params.filters = [{ contractIds }];
  }

  const result = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getEvents", params);
  const events = result.result?.events ?? [];

  const output = {
    fetchedAt: nowIso(),
    rpcUrl,
    latestLedger,
    request: params,
    count: events.length,
    firstEvent: events[0] ?? null,
    events,
  };

  console.dir(
    {
      latestLedger,
      startLedger,
      count: events.length,
      firstEvent: events[0] ?? null,
    },
    { depth: 8 }
  );

  await saveJson("02-rpc-events-sample.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});