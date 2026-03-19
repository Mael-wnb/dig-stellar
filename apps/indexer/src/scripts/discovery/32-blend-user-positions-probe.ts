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
  
    const userAddress =
      process.env.USER_ADDRESS ??
      "GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD";
  
    const positionsRes = await simulateContractRead({
      rpcUrl,
      horizonUrl,
      contractId: poolId,
      method: "get_positions",
      args: [userAddress],
      sourceAccount,
    });
  
    const emissionsRes = await simulateContractRead({
      rpcUrl,
      horizonUrl,
      contractId: poolId,
      method: "get_user_emissions",
      args: [userAddress, 1],
      sourceAccount,
    });
  
    const output = {
      generatedAt: nowIso(),
      poolId,
      userAddress,
      positions: positionsRes,
      userEmissionsSample: emissionsRes,
    };
  
    console.dir(output, { depth: 8 });
    await saveJson("32-blend-user-positions-probe.json", output);
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });