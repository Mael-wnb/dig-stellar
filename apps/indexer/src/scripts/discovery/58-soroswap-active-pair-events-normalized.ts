import { loadJson, saveJson, nowIso } from "./00-common";
import { toScaled } from "../shared/scaling";

function toNumString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function getField(obj: Record<string, unknown>, candidates: string[]): string | null {
  for (const key of candidates) {
    const v = toNumString(obj[key]);
    if (v !== null) return v;
  }
  return null;
}

function gtZero(raw: string | null): boolean {
  return raw !== null && Number(raw) > 0;
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

    const decodedValue = (event.decodedValue ?? {}) as Record<string, unknown>;

    const reserve0Raw = getField(decodedValue, ["new_reserve_0", "newReserve0"]);
    const reserve1Raw = getField(decodedValue, ["new_reserve_1", "newReserve1"]);

    const amount0InRaw = getField(decodedValue, ["amount_0_in", "amount0In"]);
    const amount1InRaw = getField(decodedValue, ["amount_1_in", "amount1In"]);
    const amount0OutRaw = getField(decodedValue, ["amount_0_out", "amount0Out"]);
    const amount1OutRaw = getField(decodedValue, ["amount_1_out", "amount1Out"]);

    let tokenIn: string | null = null;
    let tokenOut: string | null = null;
    let tokenAmountInRaw: string | null = null;
    let tokenAmountOutRaw: string | null = null;
    let tokenAmountInScaled: string | null = null;
    let tokenAmountOutScaled: string | null = null;

    if (subEventName === "swap") {
      if (gtZero(amount0InRaw)) {
        tokenIn = token0;
        tokenAmountInRaw = amount0InRaw;
        tokenAmountInScaled = toScaled(amount0InRaw, token0Decimals);
      } else if (gtZero(amount1InRaw)) {
        tokenIn = token1;
        tokenAmountInRaw = amount1InRaw;
        tokenAmountInScaled = toScaled(amount1InRaw, token1Decimals);
      }

      if (gtZero(amount0OutRaw)) {
        tokenOut = token0;
        tokenAmountOutRaw = amount0OutRaw;
        tokenAmountOutScaled = toScaled(amount0OutRaw, token0Decimals);
      } else if (gtZero(amount1OutRaw)) {
        tokenOut = token1;
        tokenAmountOutRaw = amount1OutRaw;
        tokenAmountOutScaled = toScaled(amount1OutRaw, token1Decimals);
      }
    }

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
      tokenIn,
      tokenOut,
      tokenAmountInRaw,
      tokenAmountOutRaw,
      tokenAmountInScaled,
      tokenAmountOutScaled,
      reserve0Raw,
      reserve1Raw,
      reserve0Scaled: toScaled(reserve0Raw, token0Decimals),
      reserve1Scaled: toScaled(reserve1Raw, token1Decimals),
      decodedTopics: event.decodedTopics,
      decodedValue,
    };
  });

  const firstSwapRow = rows.find((r: any) => r.subEventName === "swap") ?? null;

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
      firstSwapRow,
    },
    { depth: 8 }
  );

  await saveJson("58-soroswap-active-pair-events-normalized.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});