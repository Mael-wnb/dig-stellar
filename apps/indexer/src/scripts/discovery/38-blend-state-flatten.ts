// apps/indexer/src/scripts/discovery/38-blend-state-flatten.ts
import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const poolData = await loadJson<any>("34-blend-sdk-pool-load.json");
  const assetsResolved = await loadJson<any>("37-blend-reserve-assets-resolve.json");

  const reserves = poolData?.reserves ?? [];
  const assetRows = assetsResolved?.results ?? [];

  const assetMap = new Map<string, any>();
  for (const row of assetRows) {
    assetMap.set(row.contractId, row);
  }

  const flattenedReserves = reserves.map((entry: any) => {
    const assetId = entry.assetId;
    const reserve = entry.reserve;
    const assetMeta = assetMap.get(assetId);

    return {
      assetId,
      symbol: assetMeta?.symbol ?? null,
      name: assetMeta?.name ?? null,
      decimals: assetMeta?.decimals ?? reserve?.config?.decimals ?? null,

      index: reserve?.config?.index ?? null,
      enabled: reserve?.config?.enabled ?? null,
      supplyCap: reserve?.config?.supply_cap?.toString?.() ?? reserve?.config?.supply_cap ?? null,

      dRate: reserve?.data?.dRate?.toString?.() ?? reserve?.data?.dRate ?? null,
      bRate: reserve?.data?.bRate?.toString?.() ?? reserve?.data?.bRate ?? null,
      dSupply: reserve?.data?.dSupply?.toString?.() ?? reserve?.data?.dSupply ?? null,
      bSupply: reserve?.data?.bSupply?.toString?.() ?? reserve?.data?.bSupply ?? null,
      backstopCredit:
        reserve?.data?.backstopCredit?.toString?.() ?? reserve?.data?.backstopCredit ?? null,
      lastTime: reserve?.data?.lastTime ?? null,

      borrowApr: reserve?.borrowApr ?? null,
      estBorrowApy: reserve?.estBorrowApy ?? null,
      supplyApr: reserve?.supplyApr ?? null,
      estSupplyApy: reserve?.estSupplyApy ?? null,

      supplyEmissionEps:
        reserve?.supplyEmissions?.eps?.toString?.() ?? reserve?.supplyEmissions?.eps ?? null,
      supplyEmissionIndex:
        reserve?.supplyEmissions?.index?.toString?.() ?? reserve?.supplyEmissions?.index ?? null,
      supplyEmissionExpiration: reserve?.supplyEmissions?.expiration ?? null,
    };
  });

  const output = {
    generatedAt: nowIso(),
    poolId: poolData?.poolId ?? null,
    poolName: poolData?.poolMetadata?.name ?? null,
    reserveCount: flattenedReserves.length,
    flattenedReserves,
  };

  console.dir(
    {
      poolId: output.poolId,
      poolName: output.poolName,
      reserveCount: output.reserveCount,
      firstReserve: flattenedReserves[0] ?? null,
    },
    { depth: 8 }
  );

  await saveJson("38-blend-state-flatten.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});