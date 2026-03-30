// apps/indexer/src/scripts/discovery/36-blend-state-snapshot-v0.ts
import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const poolData = await loadJson<any>("34-blend-sdk-pool-load.json");

  const poolId = poolData?.poolId ?? null;
  const metadata = poolData?.poolMetadata ?? {};
  const reserves = poolData?.reserves ?? [];

  const snapshot = {
    generatedAt: nowIso(),
    venueSlug: "blend",
    entitySlug: "blend-real-pool",
    poolId,
    poolName:
      metadata?.name ??
      metadata?.poolName ??
      null,
    reserveCount: reserves.length,
    reserveAssets: reserves.map((r: any) => r.assetId),
    reserves,
  };

  console.dir(
    {
      poolId,
      poolName: snapshot.poolName,
      reserveCount: snapshot.reserveCount,
      reserveAssets: snapshot.reserveAssets,
    },
    { depth: 8 }
  );

  await saveJson("36-blend-state-snapshot-v0.json", snapshot);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});