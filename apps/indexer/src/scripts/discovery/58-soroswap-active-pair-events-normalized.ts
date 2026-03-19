import { loadJson, saveJson, nowIso } from "./00-common";

function toScaled(raw: string | null, decimals: number | null): string | null {
  if (!raw || decimals === null || !Number.isFinite(decimals)) return null;

  const s = String(raw);
  const d = Number(decimals);
  if (d === 0) return s;

  const padded = s.padStart(d + 1, "0");
  const intPart = padded.slice(0, -d);
  const fracPart = padded.slice(-d).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

async function main() {
  const pairShape = await loadJson<any>("57-soroswap-active-pair-db-shape.json");
  const eventsFile = await loadJson<any>("50-soroswap-pair-events.json");

  if (!pairShape || !eventsFile) {
    throw new Error("Missing 57-soroswap-active-pair-db-shape.json or 50-soroswap-pair-events.json");
  }

  const token0 = pairShape.token0;
  const token1 = pairShape.token1;

  const assetMap = new Map<string, any>();
  for (const asset of pairShape.assets ?? []) {
    assetMap.set(asset.contractId, asset);
  }

  const token0Decimals = assetMap.get(token0)?.decimals ?? null;
  const token1Decimals = assetMap.get(token1)?.decimals ?? null;

  const rows = (eventsFile.decodedEvents ?? []).map((event: any) => {
    const subEventName =
      Array.isArray(event.decodedTopics) && typeof event.decodedTopics[1] === "string"
        ? event.decodedTopics[1]
        : null;

    const decodedValue = event.decodedValue ?? {};

    const reserve0Raw =
      typeof decodedValue.new_reserve_0 === "string" ? decodedValue.new_reserve_0 : null;
    const reserve1Raw =
      typeof decodedValue.new_reserve_1 === "string" ? decodedValue.new_reserve_1 : null;

    return {
      venueSlug: "soroswap",
      entitySlug: "soroswap-native-usdc-pair",
      pairId: pairShape.pairId,
      txHash: event.txHash,
      eventId: event.id,
      ledger: event.ledger,
      occurredAt: event.ledgerClosedAt,
      eventName: event.eventName,
      subEventName,
      eventKey: `${event.eventName}:${subEventName ?? "unknown"}`,
      token0,
      token1,
      reserve0Raw,
      reserve1Raw,
      reserve0Scaled: toScaled(reserve0Raw, token0Decimals),
      reserve1Scaled: toScaled(reserve1Raw, token1Decimals),
      decodedTopics: event.decodedTopics,
      decodedValue,
    };
  });

  const output = {
    generatedAt: nowIso(),
    pairId: pairShape.pairId,
    count: rows.length,
    rows,
  };

  console.dir(
    {
      pairId: output.pairId,
      count: output.count,
      firstRow: rows[0] ?? null,
    },
    { depth: 8 }
  );

  await saveJson("58-soroswap-active-pair-events-normalized.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});