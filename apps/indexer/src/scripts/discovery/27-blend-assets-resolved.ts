import { loadJson, saveJson, nowIso } from "./00-common";

function pickDecoded(result: any): unknown {
  return result?.ok ? result.decoded : null;
}

async function main() {
  const meta = await loadJson<any>("25-blend-token-metadata-probe.json");

  const results = meta?.results ?? [];

  const assets = results.map((row: any) => ({
    chain: "stellar-mainnet",
    contractAddress: row.contractId,
    assetType: "soroban_token",
    name: pickDecoded(row.name),
    symbol: pickDecoded(row.symbol),
    decimals: pickDecoded(row.decimals),
    seenCount: row.seenCount,
    metadata: {
      source: "blend_token_metadata_probe",
    },
  }));

  const output = {
    generatedAt: nowIso(),
    assets,
  };

  console.dir(output, { depth: 8 });
  await saveJson("27-blend-assets-resolved.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});