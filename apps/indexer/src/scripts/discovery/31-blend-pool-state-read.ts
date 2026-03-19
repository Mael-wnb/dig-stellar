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
  
    const poolId =
      process.env.POOL_ID ??
      "CAS3FL6TLZKDGGSISDBWGGPXT3NRR4DYTZD7YOD3HMYO6LTJUVGRVEAM";
  
    const configRes = await simulateContractRead({
      rpcUrl,
      horizonUrl,
      contractId: poolId,
      method: "get_config",
      sourceAccount,
    });
  
    const adminRes = await simulateContractRead({
      rpcUrl,
      horizonUrl,
      contractId: poolId,
      method: "get_admin",
      sourceAccount,
    });
  
    const reserveListRes = await simulateContractRead({
      rpcUrl,
      horizonUrl,
      contractId: poolId,
      method: "get_reserve_list",
      sourceAccount,
    });
  
    const reserveList = Array.isArray(reserveListRes.decoded)
      ? reserveListRes.decoded
      : [];
  
    const reserveReads = [];
  
    for (const asset of reserveList) {
      if (typeof asset !== "string") continue;
  
      const reserveRes = await simulateContractRead({
        rpcUrl,
        horizonUrl,
        contractId: poolId,
        method: "get_reserve",
        args: [asset],
        sourceAccount,
      });
  
      reserveReads.push({
        asset,
        reserve: reserveRes,
      });
  
      console.log("get_reserve", asset, "=>", reserveRes.ok ? reserveRes.decoded : reserveRes.error);
    }
  
    const output = {
      generatedAt: nowIso(),
      poolId,
      sourceAccount,
      config: configRes,
      admin: adminRes,
      reserveList: reserveListRes,
      reserveReads,
    };
  
    await saveJson("31-blend-pool-state-read.json", output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });