import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const registry = await loadJson<any>("41-blend-final-registry.json");

  const output = {
    generatedAt: nowIso(),
    venueSlug: "blend",
    entitySlug: registry?.pool?.entitySlug ?? "blend-fixed-pool",
    entityType: "lending_pool",
    poolId: registry?.pool?.poolId ?? null,
    poolName: registry?.pool?.name ?? null,
    reserveCount: registry?.pool?.reserveCount ?? 0,
    totalEvents: registry?.activity?.totalEvents ?? 0,
    totalDeposits: registry?.activity?.totalDeposits ?? 0,
    totalSwaps: registry?.activity?.totalSwaps ?? 0,
    totalExitPool: registry?.activity?.totalExitPool ?? 0,
    uniqueCallers: registry?.activity?.uniqueCallers ?? 0,
  };

  console.dir(output, { depth: 8 });
  await saveJson("42-blend-pool-snapshot-db-ready.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});