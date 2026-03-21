import { loadJson, nowIso, saveJson } from './00-common';

function scale(raw: string | null | undefined, decimals: number | null | undefined): string | null {
  if (!raw || decimals === null || decimals === undefined) return null;

  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;

  if (decimals === 0) return raw;

  const padded = digits.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, -decimals) || '0';
  const fracPart = padded.slice(-decimals).replace(/0+$/, '');
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;

  return negative ? `-${out}` : out;
}

async function main() {
  const shape = await loadJson<any>('57-aquarius-active-pool-db-shape.json');
  const poolEvents = await loadJson<any>('50-aquarius-pool-events.json');

  if (!shape) throw new Error('Missing 57-aquarius-active-pool-db-shape.json');
  if (!poolEvents) throw new Error('Missing 50-aquarius-pool-events.json');

  if (poolEvents.poolId && shape.poolId && poolEvents.poolId !== shape.poolId) {
    throw new Error(`Mismatch between 50 and 57 poolId: ${poolEvents.poolId} !== ${shape.poolId}`);
  }

  const asset0 = (shape.assets ?? []).find((a: any) => a.contractId === shape.token0);
  const asset1 = (shape.assets ?? []).find((a: any) => a.contractId === shape.token1);

  if (!asset0 || !asset1) {
    throw new Error('Missing asset0/asset1 in 57 Aquarius output');
  }

  const decimalsByContract = new Map<string, number>([
    [shape.token0, asset0.decimals ?? 7],
    [shape.token1, asset1.decimals ?? 7],
  ]);

  const sourceEvents = Array.isArray(poolEvents.decodedEvents)
    ? poolEvents.decodedEvents
    : Array.isArray(poolEvents.events)
      ? poolEvents.events
      : [];

  const rows = sourceEvents.map((event: any) => {
    const eventName = event.eventName ?? null;
    const decodedTopics = Array.isArray(event.decodedTopics) ? event.decodedTopics : [];
    const decodedValue = Array.isArray(event.decodedValue) ? event.decodedValue : [];

    let tokenIn: string | null = null;
    let tokenOut: string | null = null;
    let callerAddress: string | null = null;

    let tokenAmountInRaw: string | null = null;
    let tokenAmountOutRaw: string | null = null;
    let tokenAmountInScaled: string | null = null;
    let tokenAmountOutScaled: string | null = null;

    let feeAmountRaw: string | null = null;
    let feeAmountScaled: string | null = null;

    let reserve0Raw: string | null = null;
    let reserve1Raw: string | null = null;
    let reserve0Scaled: string | null = null;
    let reserve1Scaled: string | null = null;

    if (eventName === 'trade') {
      tokenIn = decodedTopics[1] ? String(decodedTopics[1]) : null;
      tokenOut = decodedTopics[2] ? String(decodedTopics[2]) : null;
      callerAddress = decodedTopics[3] ? String(decodedTopics[3]) : null;

      tokenAmountInRaw = decodedValue[0] ? String(decodedValue[0]) : null;
      tokenAmountOutRaw = decodedValue[1] ? String(decodedValue[1]) : null;
      feeAmountRaw = decodedValue[2] ? String(decodedValue[2]) : null;

      const tokenInDecimals = tokenIn ? decimalsByContract.get(tokenIn) ?? null : null;
      const tokenOutDecimals = tokenOut ? decimalsByContract.get(tokenOut) ?? null : null;

      tokenAmountInScaled = scale(tokenAmountInRaw, tokenInDecimals);
      tokenAmountOutScaled = scale(tokenAmountOutRaw, tokenOutDecimals);
      feeAmountScaled = scale(feeAmountRaw, tokenInDecimals);
    }

    if (eventName === 'update_reserves') {
      reserve0Raw = decodedValue[0] ? String(decodedValue[0]) : null;
      reserve1Raw = decodedValue[1] ? String(decodedValue[1]) : null;

      reserve0Scaled = scale(reserve0Raw, asset0.decimals ?? 7);
      reserve1Scaled = scale(reserve1Raw, asset1.decimals ?? 7);
    }

    return {
      venueSlug: 'aquarius',
      entitySlug: shape.entitySlug,
      poolId: shape.poolId,
      txHash: event.txHash,
      eventId: event.id,
      ledger: event.ledger,
      occurredAt: event.ledgerClosedAt,
      eventName,
      subEventName: eventName,
      eventKey: eventName ? `AquariusPool:${eventName}` : 'AquariusPool',
      callerAddress,
      token0: shape.token0,
      token1: shape.token1,
      tokenIn,
      tokenOut,
      tokenAmountInRaw,
      tokenAmountOutRaw,
      tokenAmountInScaled,
      tokenAmountOutScaled,
      feeAmountRaw,
      feeAmountScaled,
      reserve0Raw,
      reserve1Raw,
      reserve0Scaled,
      reserve1Scaled,
      decodedTopics,
      decodedValue: event.decodedValue,
    };
  });

  const eventCounts: Record<string, number> = {};
  for (const row of rows) {
    eventCounts[row.eventKey] = (eventCounts[row.eventKey] ?? 0) + 1;
  }

  const firstRow = rows[0] ?? null;
  const firstTradeRow = rows.find((row: any) => row.eventKey === 'AquariusPool:trade') ?? null;
  const firstReserveRow = rows.find((row: any) => row.eventKey === 'AquariusPool:update_reserves') ?? null;

  const output = {
    generatedAt: nowIso(),
    poolId: shape.poolId,
    entitySlug: shape.entitySlug,
    sourceEventsCount: sourceEvents.length,
    count: rows.length,
    eventCounts,
    rows,
    firstRow,
    firstTradeRow,
    firstReserveRow,
  };

  console.dir(
    {
      poolId: output.poolId,
      entitySlug: output.entitySlug,
      sourceEventsCount: output.sourceEventsCount,
      count: output.count,
      eventCounts: output.eventCounts,
      firstTradeRow: output.firstTradeRow,
      firstReserveRow: output.firstReserveRow,
    },
    { depth: 8 }
  );

  await saveJson('58-aquarius-active-pool-events-normalized.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});