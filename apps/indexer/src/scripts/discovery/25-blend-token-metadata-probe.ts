import {
    getEnv,
    loadJson,
    saveJson,
    nowIso,
    simulateContractRead,
  } from "./00-common";
  
  async function main() {
    const rpcUrl = getEnv("STELLAR_RPC_URL");
    const horizonUrl = getEnv("HORIZON_URL");
    const sourceAccount =
      process.env.SOURCE_ACCOUNT ??
      "GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD";
  
    const assetsFile = await loadJson<any>("20-blend-assets-from-events.json");
    const assets = assetsFile?.assets ?? [];
  
    if (!assets.length) {
      throw new Error("No assets found in 20-blend-assets-from-events.json");
    }
  
    const results = [];
  
    for (const asset of assets) {
      const contractId = asset.contractAddress;
  
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
        seenCount: asset.seenCount,
        name: nameRes,
        symbol: symbolRes,
        decimals: decimalsRes,
      });
  
      console.log(contractId, {
        name: nameRes.ok ? nameRes.decoded : nameRes.error,
        symbol: symbolRes.ok ? symbolRes.decoded : symbolRes.error,
        decimals: decimalsRes.ok ? decimalsRes.decoded : decimalsRes.error,
      });
    }
  
    const output = {
      generatedAt: nowIso(),
      sourceAccount,
      results,
    };
  
    await saveJson("25-blend-token-metadata-probe.json", output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });