import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const poolSummary = await loadJson<any>("16-blend-pool-token-summary.json");
  const tokenCounts = poolSummary?.tokenCounts ?? {};

  const assets = Object.entries(tokenCounts).map(([address, seenCount]) => ({
    chain: "stellar-mainnet",
    contractAddress: address,
    seenCount,
    source: "blend_pool_events",
    assetTypeGuess: "soroban_token",
  }));

  const output = {
    generatedAt: nowIso(),
    venue: "blend",
    assets,
  };

  console.dir(output, { depth: 8 });
  await saveJson("20-blend-assets-from-events.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
