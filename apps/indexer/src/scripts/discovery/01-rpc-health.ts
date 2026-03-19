import { getEnv, rpcCall, saveJson, nowIso } from "./00-common";

type RpcEnvelope<T> = {
  jsonrpc: "2.0";
  id: string;
  result?: T;
  error?: unknown;
};

async function main() {
  const rpcUrl = getEnv("STELLAR_RPC_URL");

  const [health, latestLedger, network] = await Promise.all([
    rpcCall<RpcEnvelope<any>>(rpcUrl, "getHealth"),
    rpcCall<RpcEnvelope<any>>(rpcUrl, "getLatestLedger"),
    rpcCall<RpcEnvelope<any>>(rpcUrl, "getNetwork"),
  ]);

  const latest = latestLedger.result;

  const output = {
    fetchedAt: nowIso(),
    rpcUrl,
    health: health.result,
    network: network.result,
    latestLedger: latest
      ? {
          id: latest.id,
          protocolVersion: latest.protocolVersion,
          sequence: latest.sequence,
          closeTime: latest.closeTime,
        }
      : null,
  };

  console.dir(output, { depth: 6 });
  await saveJson("01-rpc-health.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});