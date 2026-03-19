import { getEnv, rpcCall, saveJson, nowIso } from "./00-common";

type RpcEnvelope<T> = {
  jsonrpc: "2.0";
  id: string;
  result?: T;
  error?: unknown;
};

async function main() {
  const rpcUrl = getEnv("STELLAR_RPC_URL");
  const limit = Number(process.env.TX_LIMIT ?? 25);

  const latestLedgerResp = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getLatestLedger");
  const latestLedger = latestLedgerResp.result?.sequence;

  if (!latestLedger) {
    throw new Error("Could not retrieve latest ledger");
  }

  const startLedger = Number(process.env.TX_START_LEDGER ?? latestLedger - 200);

  const result = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getTransactions", {
    startLedger,
    pagination: { limit },
  });

  const txs = result.result?.transactions ?? [];

  const output = {
    fetchedAt: nowIso(),
    rpcUrl,
    latestLedger,
    startLedger,
    count: txs.length,
    firstTx: txs[0] ?? null,
    result: result.result,
  };

  console.dir(
    {
      latestLedger,
      startLedger,
      count: txs.length,
      firstTx: txs[0] ?? null,
    },
    { depth: 8 }
  );

  await saveJson("04-rpc-transactions-sample.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});