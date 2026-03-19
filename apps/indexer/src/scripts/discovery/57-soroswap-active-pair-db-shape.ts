import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const pairProbe = await loadJson<any>("55-soroswap-active-pair-probe.json");
  const assets = await loadJson<any>("56-soroswap-active-pair-assets-resolve.json");
  const events = await loadJson<any>("50-soroswap-pair-events.json");

  const token0 = pairProbe?.results?.find((r: any) => r.method === "token_0")?.decoded ?? null;
  const token1 = pairProbe?.results?.find((r: any) => r.method === "token_1")?.decoded ?? null;
  const reserves = pairProbe?.results?.find((r: any) => r.method === "get_reserves")?.decoded ?? null;

  const output = {
    generatedAt: nowIso(),
    venueSlug: "soroswap",
    entityType: "amm_pool",
    pairId: pairProbe?.pairId ?? null,
    token0,
    token1,
    reserves,
    assets: assets?.results ?? [],
    recentEventCount: events?.count ?? 0,
    firstEvent: events?.decodedEvents?.[0] ?? null,
  };

  console.dir(output, { depth: 8 });
  await saveJson("57-soroswap-active-pair-db-shape.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});