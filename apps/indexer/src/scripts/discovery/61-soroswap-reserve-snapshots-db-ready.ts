import { loadJson, saveJson, nowIso } from "./00-common";

function toScaled(raw: string | null, decimals: number | null): string | null {
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
  const registry = await loadJson<any>("59-soroswap-final-registry.json");
  if (!registry) throw new Error("Missing 59-soroswap-final-registry.json");

  const reservesRaw = registry.pair.reservesRaw ?? [];
  const assets = registry.assets ?? [];

  if (reservesRaw.length < 2 || assets.length < 2) {
    throw new Error("Soroswap pair reserves/assets incomplete");
  }

  const token0 = assets.find((a: any) => a.contractId === registry.pair.token0);
  const token1 = assets.find((a: any) => a.contractId === registry.pair.token1);

  const reserveRows = [
    {
      generatedAt: nowIso(),
      venueSlug: "soroswap",
      entitySlug: registry.pair.entitySlug,
      assetId: token0.contractId,
      symbol: token0.symbol,
      name: token0.name,
      decimals: token0.decimals,
      enabled: true,
      dSupplyRaw: reservesRaw[0],
      bSupplyRaw: null,
      backstopCreditRaw: null,
      dSupplyScaled: toScaled(reservesRaw[0], token0.decimals),
      bSupplyScaled: null,
      backstopCreditScaled: null,
      supplyCapRaw: null,
      supplyCapScaled: null,
      borrowApr: null,
      estBorrowApy: null,
      supplyApr: null,
      estSupplyApy: null,
    },
    {
      generatedAt: nowIso(),
      venueSlug: "soroswap",
      entitySlug: registry.pair.entitySlug,
      assetId: token1.contractId,
      symbol: token1.symbol,
      name: token1.name,
      decimals: token1.decimals,
      enabled: true,
      dSupplyRaw: reservesRaw[1],
      bSupplyRaw: null,
      backstopCreditRaw: null,
      dSupplyScaled: toScaled(reservesRaw[1], token1.decimals),
      bSupplyScaled: null,
      backstopCreditScaled: null,
      supplyCapRaw: null,
      supplyCapScaled: null,
      borrowApr: null,
      estBorrowApy: null,
      supplyApr: null,
      estSupplyApy: null,
    },
  ];

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

  await saveJson("61-soroswap-reserve-snapshots-db-ready.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});