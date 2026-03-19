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
  
    const registry = await loadJson<any>("18-blend-registry.json");
    const contracts =
      registry?.contracts?.map((c: any) => c.contractAddress).filter(Boolean) ?? [];
  
    const candidateMethods = ["get_config", "get_admin", "get_reserve_list"];
  
    const results = [];
  
    for (const contractId of contracts) {
      const methodResults = [];
  
      for (const method of candidateMethods) {
        const res = await simulateContractRead({
          rpcUrl,
          horizonUrl,
          contractId,
          method,
          sourceAccount,
        });
  
        methodResults.push(res);
        console.log(contractId, method, "=>", res.ok ? res.decoded : res.error);
      }
  
      results.push({
        contractId,
        methodResults,
      });
    }
  
    const output = {
      generatedAt: nowIso(),
      sourceAccount,
      results,
    };
  
    await saveJson("30-blend-pool-candidate-probe.json", output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });