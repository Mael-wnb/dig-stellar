import { getEnv, loadJson, saveJson, nowIso, simulateContractRead } from "./00-common";

async function main() {
  const rpcUrl = process.env.SOROBAN_RPC_URL ?? getEnv('STELLAR_RPC_URL');
  const horizonUrl = getEnv("HORIZON_URL");
  const sourceAccount =
    process.env.SOURCE_ACCOUNT ??
    "GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD";

  const pairProbe = await loadJson<any>("55-soroswap-active-pair-probe.json");
  if (!pairProbe) throw new Error("Missing 55-soroswap-active-pair-probe.json");

  const token0 = pairProbe.results?.find((r: any) => r.method === "token_0")?.decoded;
  const token1 = pairProbe.results?.find((r: any) => r.method === "token_1")?.decoded;

  const tokens = [token0, token1].filter(Boolean);
  const results = [];

  for (const contractId of tokens) {
    const [nameRes, symbolRes, decimalsRes] = await Promise.all([
      simulateContractRead({ rpcUrl, horizonUrl, contractId, method: "name", sourceAccount }),
      simulateContractRead({ rpcUrl, horizonUrl, contractId, method: "symbol", sourceAccount }),
      simulateContractRead({ rpcUrl, horizonUrl, contractId, method: "decimals", sourceAccount }),
    ]);

    results.push({
      contractId,
      name: nameRes.ok ? nameRes.decoded : null,
      symbol: symbolRes.ok ? symbolRes.decoded : null,
      decimals: decimalsRes.ok ? decimalsRes.decoded : null,
    });

    console.log(contractId, {
      name: nameRes.ok ? nameRes.decoded : nameRes.error,
      symbol: symbolRes.ok ? symbolRes.decoded : symbolRes.error,
      decimals: decimalsRes.ok ? decimalsRes.decoded : decimalsRes.error,
    });
  }

  await saveJson("56-soroswap-active-pair-assets-resolve.json", {
    generatedAt: nowIso(),
    pairId: pairProbe.pairId,
    results,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});