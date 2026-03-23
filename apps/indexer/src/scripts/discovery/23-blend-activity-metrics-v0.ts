import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const dbReady = await loadJson<any>("22-blend-events-db-ready.json");
  const rows = dbReady?.rows ?? [];

  const metrics = {
    generatedAt: nowIso(),
    venueSlug: "blend",
    entitySlug: "blend-primary-pool",
    totalEvents: rows.length,
    totalDeposits: 0,
    totalSwaps: 0,
    totalExitPool: 0,
    uniqueCallers: 0,
    callers: new Set<string>(),
    tokenInCounts: {} as Record<string, number>,
    tokenOutCounts: {} as Record<string, number>,
    depositAmountSamples: [] as string[],
    swapAmountSamples: [] as string[],
  };

  for (const row of rows) {
    if (row.callerAddress) metrics.callers.add(row.callerAddress);

    if (row.eventKey === "POOL:deposit") {
      metrics.totalDeposits += 1;
      if (row.tokenAmountIn && metrics.depositAmountSamples.length < 20) {
        metrics.depositAmountSamples.push(row.tokenAmountIn);
      }
    }

    if (row.eventKey === "POOL:swap") {
      metrics.totalSwaps += 1;
      if (row.tokenAmountIn && metrics.swapAmountSamples.length < 20) {
        metrics.swapAmountSamples.push(row.tokenAmountIn);
      }
    }

    if (row.eventKey === "POOL:exit_pool") {
      metrics.totalExitPool += 1;
    }

    if (row.tokenIn) {
      metrics.tokenInCounts[row.tokenIn] = (metrics.tokenInCounts[row.tokenIn] ?? 0) + 1;
    }

    if (row.tokenOut) {
      metrics.tokenOutCounts[row.tokenOut] = (metrics.tokenOutCounts[row.tokenOut] ?? 0) + 1;
    }
  }

  const output = {
    generatedAt: metrics.generatedAt,
    venueSlug: metrics.venueSlug,
    entitySlug: metrics.entitySlug,
    totalEvents: metrics.totalEvents,
    totalDeposits: metrics.totalDeposits,
    totalSwaps: metrics.totalSwaps,
    totalExitPool: metrics.totalExitPool,
    uniqueCallers: metrics.callers.size,
    tokenInCounts: metrics.tokenInCounts,
    tokenOutCounts: metrics.tokenOutCounts,
    depositAmountSamples: metrics.depositAmountSamples,
    swapAmountSamples: metrics.swapAmountSamples,
  };

  console.dir(output, { depth: 8 });
  await saveJson("23-blend-activity-metrics-v0.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});