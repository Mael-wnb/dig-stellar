// apps/indexer/src/scripts/discovery/44-blend-missing-prices.ts
import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const reserves = await loadJson<any>("43-blend-reserve-snapshots-db-ready.json");
  const rows = reserves?.reserveRows ?? [];

  const output = {
    generatedAt: nowIso(),
    missingPrices: rows.map((row: any) => ({
      assetId: row.assetId,
      symbol: row.symbol,
      name: row.name,
      needsPrice: true,
      notes:
        row.symbol === "native"
          ? "Needs XLM/USD source"
          : `Needs ${row.symbol}/USD source`,
    })),
  };

  console.dir(output, { depth: 8 });
  await saveJson("44-blend-missing-prices.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});