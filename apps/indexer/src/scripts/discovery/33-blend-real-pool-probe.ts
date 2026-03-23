import {
    getEnv,
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
  
    const candidatePools = (
      process.env.CANDIDATE_POOLS ??
      "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  
    const methods = [
      "get_config",
      "get_admin",
      "get_reserve_list",
    ];
  
    const results = [];
  
    for (const poolId of candidatePools) {
      const methodResults = [];
  
      for (const method of methods) {
        const res = await simulateContractRead({
          rpcUrl,
          horizonUrl,
          contractId: poolId,
          method,
          sourceAccount,
        });
  
        methodResults.push(res);
        console.log(poolId, method, "=>", res.ok ? res.decoded : res.error);
      }
  
      results.push({
        poolId,
        methodResults,
      });
    }
  
    const output = {
      generatedAt: nowIso(),
      sourceAccount,
      results,
    };
  
    await saveJson("33-blend-real-pool-probe.json", output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });