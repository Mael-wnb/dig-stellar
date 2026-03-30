// apps/indexer/src/lib/protocols/aquarius/types.ts
import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const poolSnapshot = await loadJson<any>("36-blend-state-snapshot-v0.json");
  const reserveAssets = await loadJson<any>("37-blend-reserve-assets-resolve.json");
  const reserveMetrics = await loadJson<any>("39-blend-reserve-metrics.json");
  const activity = await loadJson<any>("23-blend-activity-metrics-v0.json");

  const output = {
    generatedAt: nowIso(),
    venue: {
      slug: "blend",
      name: "Blend",
      chain: "stellar-mainnet",
      venueType: "lending",
    },
    pool: {
      entitySlug: "blend-fixed-pool",
      poolId: poolSnapshot?.poolId ?? null,
      name: poolSnapshot?.poolName ?? null,
      reserveCount: poolSnapshot?.reserveCount ?? 0,
    },
    reserves:
      reserveAssets?.results?.map((asset: any) => ({
        assetId: asset.contractId,
        symbol: asset.symbol,
        name: asset.name,
        decimals: asset.decimals,
      })) ?? [],
    activity: {
      totalEvents: activity?.totalEvents ?? 0,
      totalDeposits: activity?.totalDeposits ?? 0,
      totalSwaps: activity?.totalSwaps ?? 0,
      totalExitPool: activity?.totalExitPool ?? 0,
      uniqueCallers: activity?.uniqueCallers ?? 0,
    },
    reserveMetrics: reserveMetrics?.reserveMetrics ?? [],
  };

  console.dir(output, { depth: 8 });
  await saveJson("41-blend-final-registry.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});