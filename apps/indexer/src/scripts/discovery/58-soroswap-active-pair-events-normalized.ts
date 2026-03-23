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

function extractSwapAmounts(decodedValue: any) {
  const amount0In = decodedValue?.amount_0_in ? String(decodedValue.amount_0_in) : '0';
  const amount0Out = decodedValue?.amount_0_out ? String(decodedValue.amount_0_out) : '0';
  const amount1In = decodedValue?.amount_1_in ? String(decodedValue.amount_1_in) : '0';
  const amount1Out = decodedValue?.amount_1_out ? String(decodedValue.amount_1_out) : '0';

  return { amount0In, amount0Out, amount1In, amount1Out };
}

async function main() {
  const shape = await loadJson<any>('57-soroswap-active-pair-db-shape.json');
  const pairEvents = await loadJson<any>('50-soroswap-pair-events.json');

  if (!shape) {
    throw new Error('Missing 57-soroswap-active-pair-db-shape.json');
  }

  if (!pairEvents) {
    throw new Error('Missing 50-soroswap-pair-events.json');
  }

  if (!shape.pairId) {
    throw new Error('Missing pairId in 57-soroswap-active-pair-db-shape.json');
  }

  if (!pairEvents.pairId) {
    throw new Error('Missing pairId in 50-soroswap-pair-events.json');
  }

  if (pairEvents.pairId !== shape.pairId) {
    throw new Error(
      `Mismatch between 50 and 57 pairId: ${pairEvents.pairId} !== ${shape.pairId}`
    );
  }

  const asset0 = Array.isArray(shape.assets)
    ? shape.assets.find((a: any) => a.contractId === shape.token0)
    : null;

  const asset1 = Array.isArray(shape.assets)
    ? shape.assets.find((a: any) => a.contractId === shape.token1)
    : null;

  if (!asset0 || !asset1) {
    throw new Error('Missing asset0/asset1 in 57 output');
  }

  const decimals0 = asset0.decimals ?? 7;
  const decimals1 = asset1.decimals ?? 7;

  const sourceEvents = Array.isArray(pairEvents.decodedEvents)
    ? pairEvents.decodedEvents
    : Array.isArray(pairEvents.events)
      ? pairEvents.events
      : Array.isArray(pairEvents.results)
        ? pairEvents.results
        : Array.isArray(pairEvents.rows)
          ? pairEvents.rows
          : [];

  const rows = sourceEvents.map((event: any) => {
    const subEventName = event.decodedTopics?.[1] ?? null;
    const decodedValue = event.decodedValue ?? {};

    let tokenIn: string | null = null;
    let tokenOut: string | null = null;
    let tokenAmountInRaw: string | null = null;
    let tokenAmountOutRaw: string | null = null;
    let tokenAmountInScaled: string | null = null;
    let tokenAmountOutScaled: string | null = null;
    let reserve0Raw: string | null = null;
    let reserve1Raw: string | null = null;
    let reserve0Scaled: string | null = null;
    let reserve1Scaled: string | null = null;

    if (subEventName === 'swap') {
      const { amount0In, amount0Out, amount1In, amount1Out } = extractSwapAmounts(decodedValue);

      if (amount0In !== '0' && amount1Out !== '0') {
        tokenIn = shape.token0;
        tokenOut = shape.token1;
        tokenAmountInRaw = amount0In;
        tokenAmountOutRaw = amount1Out;
        tokenAmountInScaled = scale(amount0In, decimals0);
        tokenAmountOutScaled = scale(amount1Out, decimals1);
      } else if (amount1In !== '0' && amount0Out !== '0') {
        tokenIn = shape.token1;
        tokenOut = shape.token0;
        tokenAmountInRaw = amount1In;
        tokenAmountOutRaw = amount0Out;
        tokenAmountInScaled = scale(amount1In, decimals1);
        tokenAmountOutScaled = scale(amount0Out, decimals0);
      }
    }

    if (subEventName === 'sync') {
      reserve0Raw = decodedValue?.new_reserve_0 ? String(decodedValue.new_reserve_0) : null;
      reserve1Raw = decodedValue?.new_reserve_1 ? String(decodedValue.new_reserve_1) : null;
      reserve0Scaled = scale(reserve0Raw, decimals0);
      reserve1Scaled = scale(reserve1Raw, decimals1);
    }

    return {
      venueSlug: 'soroswap',
      entitySlug: shape.entitySlug,
      pairId: shape.pairId,
      txHash: event.txHash,
      eventId: event.id,
      ledger: event.ledger,
      occurredAt: event.ledgerClosedAt,
      eventName: event.eventName,
      subEventName,
      eventKey: subEventName ? `${event.eventName}:${subEventName}` : event.eventName,
      token0: shape.token0,
      token1: shape.token1,
      tokenIn,
      tokenOut,
      tokenAmountInRaw,
      tokenAmountOutRaw,
      tokenAmountInScaled,
      tokenAmountOutScaled,
      reserve0Raw,
      reserve1Raw,
      reserve0Scaled,
      reserve1Scaled,
      decodedTopics: event.decodedTopics,
      decodedValue: event.decodedValue,
    };
  });

  const firstRow = rows[0] ?? null;
  const firstSwapRow = rows.find((row: any) => row.subEventName === 'swap') ?? null;

  const output = {
    generatedAt: nowIso(),
    pairId: shape.pairId,
    entitySlug: shape.entitySlug,
    sourceEventsCount: sourceEvents.length,
    count: rows.length,
    rows,
    firstRow,
    firstSwapRow,
  };

  console.dir(
    {
      pairId: output.pairId,
      entitySlug: output.entitySlug,
      sourceEventsCount: output.sourceEventsCount,
      count: output.count,
      firstRow: output.firstRow,
      firstSwapRow: output.firstSwapRow,
    },
    { depth: 8 }
  );

  await saveJson('58-soroswap-active-pair-events-normalized.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});