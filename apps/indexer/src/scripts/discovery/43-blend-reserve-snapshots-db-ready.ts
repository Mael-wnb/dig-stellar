import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const registry = await loadJson<any>("41-blend-final-registry.json");
  const poolSlug = registry?.pool?.entitySlug ?? "blend-fixed-pool";

  const reserveRows =
    registry?.reserveMetrics?.map((row: any) => ({
      generatedAt: nowIso(),
      venueSlug: "blend",
      entitySlug: poolSlug,
      assetId: row.assetId,
      symbol: row.symbol,
      name: row.name,
      decimals: row.decimals,
      enabled: row.enabled,
      dSupplyRaw: row.dSupplyRaw,
      bSupplyRaw: row.bSupplyRaw,
      backstopCreditRaw: row.backstopCreditRaw,
      dSupplyScaled: row.dSupplyScaled,
      bSupplyScaled: row.bSupplyScaled,
      backstopCreditScaled: row.backstopCreditScaled,
      supplyCapRaw: row.supplyCapRaw,
      supplyCapScaled: row.supplyCapScaled,
      borrowApr: row.borrowApr,
      estBorrowApy: row.estBorrowApy,
      supplyApr: row.supplyApr,
      estSupplyApy: row.estSupplyApy,
    })) ?? [];

  const output = {
    generatedAt: nowIso(),
    reserveCount: reserveRows.length,
    reserveRows,
  };

  console.dir(
    {
      reserveCount: reserveRows.length,
      firstReserveRow: reserveRows[0] ?? null,
    },
    { depth: 8 }
  );

  await saveJson("43-blend-reserve-snapshots-db-ready.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});