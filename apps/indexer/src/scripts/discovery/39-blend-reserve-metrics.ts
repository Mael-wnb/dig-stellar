// apps/indexer/src/lib/protocols/aquarius/types.ts
import { loadJson, saveJson, nowIso } from "./00-common";

function scale(raw: string | null, decimals: number | null): string | null {
  if (!raw || decimals === null || !Number.isFinite(decimals)) return null;

  const s = String(raw);
  const d = Number(decimals);

  if (d === 0) return s;

  const padded = s.padStart(d + 1, "0");
  const intPart = padded.slice(0, -d);
  const fracPart = padded.slice(-d).replace(/0+$/, "");

  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

async function main() {
  const flattened = await loadJson<any>("38-blend-state-flatten.json");
  const rows = flattened?.flattenedReserves ?? [];

  const metrics = rows.map((row: any) => {
    const decimals =
      typeof row.decimals === "number" ? row.decimals : Number(row.decimals ?? NaN);

    return {
      assetId: row.assetId,
      symbol: row.symbol,
      name: row.name,
      decimals,

      dSupplyRaw: row.dSupply,
      bSupplyRaw: row.bSupply,
      backstopCreditRaw: row.backstopCredit,

      dSupplyScaled: scale(row.dSupply, decimals),
      bSupplyScaled: scale(row.bSupply, decimals),
      backstopCreditScaled: scale(row.backstopCredit, decimals),

      borrowApr: row.borrowApr,
      estBorrowApy: row.estBorrowApy,
      supplyApr: row.supplyApr,
      estSupplyApy: row.estSupplyApy,
      enabled: row.enabled,
      supplyCapRaw: row.supplyCap,
      supplyCapScaled: scale(row.supplyCap, decimals),
    };
  });

  const output = {
    generatedAt: nowIso(),
    poolId: flattened?.poolId ?? null,
    poolName: flattened?.poolName ?? null,
    reserveMetrics: metrics,
  };

  console.dir(
    {
      poolId: output.poolId,
      reserveMetrics: metrics,
    },
    { depth: 8 }
  );

  await saveJson("39-blend-reserve-metrics.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});