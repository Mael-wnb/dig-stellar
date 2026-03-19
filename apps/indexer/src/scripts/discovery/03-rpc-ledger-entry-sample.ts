import { getEnv, rpcCall, saveJson, nowIso } from "./00-common";

type RpcEnvelope<T> = {
  jsonrpc: "2.0";
  id: string;
  result?: T;
  error?: unknown;
};

async function main() {
  const rpcUrl = getEnv("STELLAR_RPC_URL");

  const keys = (process.env.LEDGER_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    throw new Error(
      "Set LEDGER_KEYS with one or more base64-encoded ledger entry keys"
    );
  }

  const result = await rpcCall<RpcEnvelope<any>>(rpcUrl, "getLedgerEntries", {
    keys,
  });

  const output = {
    fetchedAt: nowIso(),
    rpcUrl,
    keys,
    result,
  };

  console.dir(
    {
      keys,
      entriesCount: result.result?.entries?.length ?? 0,
      firstEntry: result.result?.entries?.[0] ?? null,
    },
    { depth: 8 }
  );

  await saveJson("03-rpc-ledger-entry-sample.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});