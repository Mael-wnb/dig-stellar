import { getEnv, saveJson, nowIso, simulateContractRead } from "./00-common";

async function main() {
  const rpcUrl = getEnv("STELLAR_RPC_URL");
  const horizonUrl = getEnv("HORIZON_URL");
  const sourceAccount =
    process.env.SOURCE_ACCOUNT ??
    "GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD";

  const factoryId = getEnv("SOROSWAP_FACTORY_ID");

  const methods = [
    "all_pairs_length",
    "fee_to",
    "fee_to_setter",
  ];

  const results = [];

  for (const method of methods) {
    const res = await simulateContractRead({
      rpcUrl,
      horizonUrl,
      contractId: factoryId,
      method,
      sourceAccount,
    });

    results.push(res);
    console.log(method, "=>", res.ok ? res.decoded : res.error);
  }

  const output = {
    generatedAt: nowIso(),
    factoryId,
    results,
  };

  await saveJson("48-soroswap-factory-probe.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});