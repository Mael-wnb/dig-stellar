import { loadJson, saveJson, nowIso } from "./00-common";

async function main() {
  const pairProbe = await loadJson<any>("49-soroswap-pair-probe.json");
  const pairEvents = await loadJson<any>("50-soroswap-pair-events.json");

  const token0 = pairProbe?.results?.find((r: any) => r.method === "token_0")?.decoded ?? null;
  const token1 = pairProbe?.results?.find((r: any) => r.method === "token_1")?.decoded ?? null;

  const eventNames = Array.from(
    new Set((pairEvents?.decodedEvents ?? []).map((e: any) => e.eventName).filter(Boolean))
  );

  const output = {
    generatedAt: nowIso(),
    entityTypeCandidate: "amm_pool",
    pairId: pairProbe?.pairId ?? null,
    token0,
    token1,
    reserveLikeMethod:
      pairProbe?.results?.find((r: any) => r.method === "get_reserves")?.ok ?? false,
    eventNames,
    fitsCurrentSchema: true,
  };

  console.dir(output, { depth: 8 });
  await saveJson("51-soroswap-fit-check.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});