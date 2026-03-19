import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const [
    rpcHealth,
    rpcEvents,
    rpcLedgerEntries,
    rpcTransactions,
    horizonPools,
    aquarius,
    blend,
  ] = await Promise.all([
    loadJson<any>("01-rpc-health.json"),
    loadJson<any>("02-rpc-events-sample.json"),
    loadJson<any>("03-rpc-ledger-entry-sample.json"),
    loadJson<any>("04-rpc-transactions-sample.json"),
    loadJson<any>("05-horizon-liquidity-pools.json"),
    loadJson<any>("06-aquarius-discovery.json"),
    loadJson<any>("07-blend-discovery.json"),
  ]);

  const report = {
    generatedAt: nowIso(),
    rpc: {
      healthy: rpcHealth?.health?.result ?? rpcHealth?.health ?? null,
      network: rpcHealth?.network?.result ?? rpcHealth?.network ?? null,
      latestLedger:
        rpcHealth?.latestLedger?.result ?? rpcHealth?.latestLedger ?? null,
    },
    events: {
      count: rpcEvents?.count ?? 0,
      topicsSeen: rpcEvents?.topicsSeen ?? [],
    },
    ledgerEntries: {
      entriesCount: rpcLedgerEntries?.result?.result?.entries?.length ?? 0,
    },
    transactions: {
      count: rpcTransactions?.count ?? 0,
    },
    horizon: {
      liquidityPoolsCount: horizonPools?.count ?? 0,
      next: horizonPools?.next ?? null,
    },
    aquarius: {
      successCount: aquarius?.successCount ?? 0,
      okEndpoints: aquarius?.okEndpoints ?? [],
    },
    blend: {
      addressesCount: blend?.addressesCount ?? 0,
      addressesPreview: blend?.addresses?.slice?.(0, 20) ?? [],
    },
  };

  console.dir(report, { depth: 8 });
  await saveJson("08-shape-report.json", report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});