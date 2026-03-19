import { getEnv, saveJson, nowIso, simulateContractRead } from "./00-common";

async function main() {
  const rpcUrl = getEnv("STELLAR_RPC_URL");
  const horizonUrl = getEnv("HORIZON_URL");
  const sourceAccount =
    process.env.SOURCE_ACCOUNT ??
    "GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD";

  const pairId = getEnv("SOROSWAP_PAIR_ID");

  const methods = [
    "token_0",
    "token_1",
    "get_reserves",
    "factory",
    "name",
    "symbol",
    "decimals",
  ];

  const results = [];

  for (const method of methods) {
    const res = await simulateContractRead({
      rpcUrl,
      horizonUrl,
      contractId: pairId,
      method,
      sourceAccount,
    });

    results.push(res);
    console.log(method, "=>", res.ok ? res.decoded : res.error);
  }

  const output = {
    generatedAt: nowIso(),
    pairId,
    results,
  };

  await saveJson("49-soroswap-pair-probe.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});