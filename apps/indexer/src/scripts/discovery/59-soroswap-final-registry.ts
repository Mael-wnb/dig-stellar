import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const pairShape = await loadJson<any>("57-soroswap-active-pair-db-shape.json");
  const normalized = await loadJson<any>("58-soroswap-active-pair-events-normalized.json");

  if (!pairShape || !normalized) {
    throw new Error("Missing 57 or 58 Soroswap files");
  }

  const eventCounts: Record<string, number> = {};
  for (const row of normalized.rows ?? []) {
    eventCounts[row.eventKey] = (eventCounts[row.eventKey] ?? 0) + 1;
  }

  const output = {
    generatedAt: nowIso(),
    venue: {
      slug: "soroswap",
      name: "Soroswap",
      chain: "stellar-mainnet",
      venueType: "amm",
    },
    pair: {
      entitySlug: "soroswap-native-usdc-pair",
      pairId: pairShape.pairId,
      name: "native-USDC Soroswap LP Token",
      reserveCount: 2,
      token0: pairShape.token0,
      token1: pairShape.token1,
      reservesRaw: pairShape.reserves,
    },
    assets: pairShape.assets ?? [],
    activity: {
      recentEventCount: pairShape.recentEventCount ?? 0,
      eventCounts,
    },
  };

  console.dir(output, { depth: 8 });
  await saveJson("59-soroswap-final-registry.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});