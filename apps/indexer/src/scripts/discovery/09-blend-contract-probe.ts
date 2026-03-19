import { getEnv, rpcCall, saveJson, nowIso, loadJson } from "./00-common";

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

  const startLedger = latestLedger - 5000;
  const results: any[] = [];

  for (const address of addresses) {
    const resp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getEvents", {
      startLedger,
      filters: [{ contractIds: [address] }],
      pagination: { limit: 20 },
    });

    const events = resp.result?.events ?? [];

    results.push({
      address,
      count: events.length,
      firstEvent: events[0] ?? null,
    });

    console.log(address, "=>", events.length, "events");
  }

  const output = {
    fetchedAt: nowIso(),
    latestLedger,
    startLedger,
    results,
  };

  await saveJson("09-blend-contract-probe.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});