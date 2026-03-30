// apps/indexer/src/scripts/discovery/37-blend-reserve-assets-resolve.ts
import { loadJson, saveJson, nowIso, getEnv, simulateContractRead } from "./00-common";

async function main() {
  const rpcUrl = getEnv("STELLAR_RPC_URL");
  const horizonUrl = getEnv("HORIZON_URL");
  const sourceAccount =
    process.env.SOURCE_ACCOUNT ??
    "GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD";

  const snapshot = await loadJson<any>("36-blend-state-snapshot-v0.json");
  const reserveAssets: string[] = snapshot?.reserveAssets ?? [];

  if (!reserveAssets.length) {
    throw new Error("No reserveAssets found in 36-blend-state-snapshot-v0.json");
  }

  const results = [];

  for (const contractId of reserveAssets) {
    const [nameRes, symbolRes, decimalsRes] = await Promise.all([
      simulateContractRead({
        rpcUrl,
        horizonUrl,
        contractId,
        method: "name",
        sourceAccount,
      }),
      simulateContractRead({
        rpcUrl,
        horizonUrl,
        contractId,
        method: "symbol",
        sourceAccount,
      }),
      simulateContractRead({
        rpcUrl,
        horizonUrl,
        contractId,
        method: "decimals",
        sourceAccount,
      }),
    ]);

    results.push({
      contractId,
      name: nameRes.ok ? nameRes.decoded : null,
      symbol: symbolRes.ok ? symbolRes.decoded : null,
      decimals: decimalsRes.ok ? decimalsRes.decoded : null,
      raw: {
        name: nameRes,
        symbol: symbolRes,
        decimals: decimalsRes,
      },
    });

    console.log(contractId, {
      name: nameRes.ok ? nameRes.decoded : nameRes.error,
      symbol: symbolRes.ok ? symbolRes.decoded : symbolRes.error,
      decimals: decimalsRes.ok ? decimalsRes.decoded : decimalsRes.error,
    });
  }

  const output = {
    generatedAt: nowIso(),
    reserveAssets,
    results,
  };

  await saveJson("37-blend-reserve-assets-resolve.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});