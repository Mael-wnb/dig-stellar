import { getEnv, saveJson, nowIso, simulateContractRead } from "./00-common";

async function main() {
  const rpcUrl = getEnv("STELLAR_RPC_URL");
  const horizonUrl = getEnv("HORIZON_URL");
  const sourceAccount =
    process.env.SOURCE_ACCOUNT ??
    "GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD";

  const factoryId = getEnv("SOROSWAP_FACTORY_ID");
  const maxPairs = Number(process.env.MAX_PAIRS ?? 20);

  const results = [];

  for (let i = 0; i < maxPairs; i++) {
    const pairRes = await simulateContractRead({
      rpcUrl,
      horizonUrl,
      contractId: factoryId,
      method: "all_pairs",
      args: [{ type: "u32", value: i }],
      sourceAccount,
    });

    const pairId = pairRes.ok ? pairRes.decoded : null;

    results.push({
      index: i,
      pairId,
      raw: pairRes,
    });

    console.log(i, "=>", pairId ?? pairRes.error);
  }

  await saveJson("53-soroswap-factory-pairs-scan.json", {
    generatedAt: nowIso(),
    factoryId,
    results,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});