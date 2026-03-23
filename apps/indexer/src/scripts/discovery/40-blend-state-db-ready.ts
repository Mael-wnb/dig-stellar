import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const flattened = await loadJson<any>("38-blend-state-flatten.json");
  const metrics = await loadJson<any>("39-blend-reserve-metrics.json");

  const reserveRows = metrics?.reserveMetrics ?? [];

  const output = {
    generatedAt: nowIso(),
    venueSlug: "blend",
    entitySlug: "blend-real-pool",
    poolId: flattened?.poolId ?? null,
    poolName: flattened?.poolName ?? null,
    reserveCount: reserveRows.length,
    reserveRows: reserveRows.map((row: any) => ({
      venueSlug: "blend",
      entitySlug: "blend-real-pool",
      assetId: row.assetId,
      symbol: row.symbol,
      name: row.name,
      decimals: row.decimals,
      dSupplyRaw: row.dSupplyRaw,
      bSupplyRaw: row.bSupplyRaw,
      backstopCreditRaw: row.backstopCreditRaw,
      dSupplyScaled: row.dSupplyScaled,
      bSupplyScaled: row.bSupplyScaled,
      backstopCreditScaled: row.backstopCreditScaled,
      borrowApr: row.borrowApr,
      estBorrowApy: row.estBorrowApy,
      supplyApr: row.supplyApr,
      estSupplyApy: row.estSupplyApy,
      enabled: row.enabled,
      supplyCapRaw: row.supplyCapRaw,
      supplyCapScaled: row.supplyCapScaled,
    })),
  };

  console.dir(
    {
      poolId: output.poolId,
      reserveCount: output.reserveCount,
      firstReserveRow: output.reserveRows[0] ?? null,
    },
    { depth: 8 }
  );

  await saveJson("40-blend-state-db-ready.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});