import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const registry = await loadJson<any>("18-blend-registry.json");
  const activity = await loadJson<any>("19-blend-activity-snapshot.json");
  const assetsFile = await loadJson<any>("20-blend-assets-from-events.json");

  const primaryPool = registry?.primaryContracts?.primaryPoolLikeContract ?? null;
  const primaryUserFlow = registry?.primaryContracts?.primaryUserFlowContract ?? null;

  const venue = {
    slug: "blend",
    name: "Blend",
    venueType: "lending_amm_hybrid",
    chain: "stellar-mainnet",
    metadata: {
      source: "discovery",
    },
  };

  const entities = [
    {
      slug: "blend-primary-pool",
      name: "Blend Primary Pool",
      entityType: "pool",
      contractAddress: primaryPool,
      status: "active",
      metadata: {
        eventCounts: activity?.eventCounts ?? {},
        uniqueCallers: activity?.uniqueCallers ?? 0,
      },
    },
    {
      slug: "blend-primary-user-flow",
      name: "Blend Primary User Flow",
      entityType: "strategy_or_rewards",
      contractAddress: primaryUserFlow,
      status: "active",
      metadata: {
        source: "discovery",
      },
    },
  ];

  const assets =
    assetsFile?.assets?.map((asset: any, index: number) => ({
      chain: asset.chain,
      contractAddress: asset.contractAddress,
      assetType: asset.assetTypeGuess,
      source: asset.source,
      seenCount: asset.seenCount,
      provisionalSymbol: `BLEND_ASSET_${index + 1}`,
    })) ?? [];

  const entityAssets = assets.map((asset: any, index: number) => ({
    entitySlug: "blend-primary-pool",
    assetContractAddress: asset.contractAddress,
    role: index === 0 ? "token0_candidate" : "token1_candidate",
    metadata: {
      seenCount: asset.seenCount,
    },
  }));

  const output = {
    generatedAt: nowIso(),
    venue,
    entities,
    assets,
    entityAssets,
  };

  console.dir(output, { depth: 8 });
  await saveJson("21-blend-v0-seed.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});