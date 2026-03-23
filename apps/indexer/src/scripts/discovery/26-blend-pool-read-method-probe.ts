import {
    getEnv,
    saveJson,
    nowIso,
    simulateContractRead,
  } from "./00-common";
  
  async function main() {
    const rpcUrl = getEnv("STELLAR_RPC_URL");
    const horizonUrl = getEnv("HORIZON_URL");
  
    const contractId =
      process.env.CONTRACT_ID ??
      "CAS3FL6TLZKDGGSISDBWGGPXT3NRR4DYTZD7YOD3HMYO6LTJUVGRVEAM";
  
    const sourceAccount =
      process.env.SOURCE_ACCOUNT ??
      "GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD";
  
    const candidateMethods = [
      "name",
      "symbol",
      "decimals",
      "get_tokens",
      "tokens",
      "get_reserves",
      "reserves",
      "get_config",
      "config",
      "factory",
      "backstop",
      "emitter",
      "oracle",
      "pool_type",
      "version",
    ];
  
    const results = [];
  
    for (const method of candidateMethods) {
      const res = await simulateContractRead({
        rpcUrl,
        horizonUrl,
        contractId,
        method,
        sourceAccount,
      });
  
      results.push(res);
  
      console.log(method, "=>", res.ok ? res.decoded : res.error);
    }
  
    const output = {
      generatedAt: nowIso(),
      contractId,
      sourceAccount,
      results,
    };
  
    await saveJson("26-blend-pool-read-method-probe.json", output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });