import { loadJson, nowIso, saveJson } from './00-common';

type SoroswapEventRow = {
  venueSlug: 'soroswap';
  entitySlug: string;
  pairId: string;
  txHash: string | null;
  eventId: string | null;
  ledger: number | null;
  occurredAt: string | null;
  eventName: string | null;
  subEventName: string | null;
  eventKey: string;
  token0: string;
  token1: string;
  tokenIn: string | null;
  tokenOut: string | null;
  tokenAmountInRaw: string | null;
  tokenAmountOutRaw: string | null;
  tokenAmountInScaled: string | null;
  tokenAmountOutScaled: string | null;
  reserve0Raw: string | null;
  reserve1Raw: string | null;
  reserve0Scaled: string | null;
  reserve1Scaled: string | null;
  decodedTopics: unknown[];
  decodedValue: unknown;
};

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

function getPairIdFrom50(eventsFile: unknown): string | null {
  if (!eventsFile || typeof eventsFile !== 'object') return null;
  const pairId = (eventsFile as { pairId?: unknown }).pairId;
  return typeof pairId === 'string' ? pairId : null;
}

function getPairIdFrom57(shape: unknown): string | null {
  if (!shape || typeof shape !== 'object') return null;
  const pairId = (shape as { pairId?: unknown }).pairId;
  return typeof pairId === 'string' ? pairId : null;
}

function getEntitySlugFrom57(shape: unknown): string {
  if (!shape || typeof shape !== 'object') {
    throw new Error('Missing 57-soroswap-active-pair-db-shape.json');
  }

  const entitySlug = (shape as { entitySlug?: unknown }).entitySlug;
  if (!entitySlug || typeof entitySlug !== 'string') {
    throw new Error('Missing entitySlug in 57-soroswap-active-pair-db-shape.json');
  }

  return entitySlug;
}

function extractSwapAmounts(decodedValue: any) {
  const amount0In = decodedValue?.amount_0_in !== undefined ? String(decodedValue.amount_0_in) : '0';
  const amount0Out = decodedValue?.amount_0_out !== undefined ? String(decodedValue.amount_0_out) : '0';
  const amount1In = decodedValue?.amount_1_in !== undefined ? String(decodedValue.amount_1_in) : '0';
  const amount1Out = decodedValue?.amount_1_out !== undefined ? String(decodedValue.amount_1_out) : '0';

  return { amount0In, amount0Out, amount1In, amount1Out };
}

function extractSwapRow(params: {
  event: any;
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
}) {
  const { event, token0, token1, decimals0, decimals1 } = params;
  const decodedValue = event.decodedValue ?? {};

  const { amount0In, amount0Out, amount1In, amount1Out } = extractSwapAmounts(decodedValue);

  if (amount0In !== '0' && amount1Out !== '0') {
    return {
      tokenIn: token0,
      tokenOut: token1,
      tokenAmountInRaw: amount0In,
      tokenAmountOutRaw: amount1Out,
      tokenAmountInScaled: scale(amount0In, decimals0),
      tokenAmountOutScaled: scale(amount1Out, decimals1),
      reserve0Raw: null,
      reserve1Raw: null,
      reserve0Scaled: null,
      reserve1Scaled: null,
    };
  }

  if (amount1In !== '0' && amount0Out !== '0') {
    return {
      tokenIn: token1,
      tokenOut: token0,
      tokenAmountInRaw: amount1In,
      tokenAmountOutRaw: amount0Out,
      tokenAmountInScaled: scale(amount1In, decimals1),
      tokenAmountOutScaled: scale(amount0Out, decimals0),
      reserve0Raw: null,
      reserve1Raw: null,
      reserve0Scaled: null,
      reserve1Scaled: null,
    };
  }

  return {
    tokenIn: null,
    tokenOut: null,
    tokenAmountInRaw: null,
    tokenAmountOutRaw: null,
    tokenAmountInScaled: null,
    tokenAmountOutScaled: null,
    reserve0Raw: null,
    reserve1Raw: null,
    reserve0Scaled: null,
    reserve1Scaled: null,
  };
}

function extractSyncRow(params: {
  event: any;
  decimals0: number;
  decimals1: number;
}) {
  const { event, decimals0, decimals1 } = params;
  const decodedValue = event.decodedValue ?? {};

  const reserve0Raw =
    decodedValue?.new_reserve_0 !== undefined ? String(decodedValue.new_reserve_0) : null;
  const reserve1Raw =
    decodedValue?.new_reserve_1 !== undefined ? String(decodedValue.new_reserve_1) : null;

  return {
    tokenIn: null,
    tokenOut: null,
    tokenAmountInRaw: null,
    tokenAmountOutRaw: null,
    tokenAmountInScaled: null,
    tokenAmountOutScaled: null,
    reserve0Raw,
    reserve1Raw,
    reserve0Scaled: scale(reserve0Raw, decimals0),
    reserve1Scaled: scale(reserve1Raw, decimals1),
  };
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

  const envPairId = process.env.SOROSWAP_PAIR_ID ?? null;
  const shapePairId = getPairIdFrom57(shape);
  const eventsPairId = getPairIdFrom50(pairEvents);

  if (!shapePairId) {
    throw new Error('Missing pairId in 57-soroswap-active-pair-db-shape.json');
  }

  if (!eventsPairId) {
    throw new Error('Missing pairId in 50-soroswap-pair-events.json');
  }

  if (envPairId && shapePairId !== envPairId) {
    throw new Error(`Mismatch between SOROSWAP_PAIR_ID and 57 pairId: ${envPairId} !== ${shapePairId}`);
  }

  if (envPairId && eventsPairId !== envPairId) {
    throw new Error(`Mismatch between SOROSWAP_PAIR_ID and 50 pairId: ${envPairId} !== ${eventsPairId}`);
  }

  if (eventsPairId !== shapePairId) {
    throw new Error(`Mismatch between 50 and 57 pairId: ${eventsPairId} !== ${shapePairId}`);
  }

  const entitySlug = getEntitySlugFrom57(shape);
  const token0 = shape.token0 as string;
  const token1 = shape.token1 as string;

  const asset0 = Array.isArray(shape.assets)
    ? shape.assets.find((a: any) => a?.contractId === token0)
    : null;

  const asset1 = Array.isArray(shape.assets)
    ? shape.assets.find((a: any) => a?.contractId === token1)
    : null;

  if (!asset0 || !asset1) {
    throw new Error('Missing asset0/asset1 in 57-soroswap-active-pair-db-shape.json');
  }

  const decimals0 = typeof asset0.decimals === 'number' ? asset0.decimals : 7;
  const decimals1 = typeof asset1.decimals === 'number' ? asset1.decimals : 7;

  const sourceEvents = Array.isArray(pairEvents.decodedEvents) ? pairEvents.decodedEvents : [];

  const rows: SoroswapEventRow[] = sourceEvents.map((event: any) => {
    const eventName = typeof event.eventName === 'string' ? event.eventName : null;
    const subEventName = eventName;
    const eventKey = eventName ? `SoroswapPair:${eventName}` : 'SoroswapPair:unknown';

    let extracted = {
      tokenIn: null as string | null,
      tokenOut: null as string | null,
      tokenAmountInRaw: null as string | null,
      tokenAmountOutRaw: null as string | null,
      tokenAmountInScaled: null as string | null,
      tokenAmountOutScaled: null as string | null,
      reserve0Raw: null as string | null,
      reserve1Raw: null as string | null,
      reserve0Scaled: null as string | null,
      reserve1Scaled: null as string | null,
    };

    if (eventName === 'swap') {
      extracted = extractSwapRow({
        event,
        token0,
        token1,
        decimals0,
        decimals1,
      });
    } else if (eventName === 'sync') {
      extracted = extractSyncRow({
        event,
        decimals0,
        decimals1,
      });
    }

    return {
      venueSlug: 'soroswap',
      entitySlug,
      pairId: shapePairId,
      txHash: event.txHash ?? null,
      eventId: event.id ?? null,
      ledger: typeof event.ledger === 'number' ? event.ledger : null,
      occurredAt: event.ledgerClosedAt ?? null,
      eventName,
      subEventName,
      eventKey,
      token0,
      token1,
      tokenIn: extracted.tokenIn,
      tokenOut: extracted.tokenOut,
      tokenAmountInRaw: extracted.tokenAmountInRaw,
      tokenAmountOutRaw: extracted.tokenAmountOutRaw,
      tokenAmountInScaled: extracted.tokenAmountInScaled,
      tokenAmountOutScaled: extracted.tokenAmountOutScaled,
      reserve0Raw: extracted.reserve0Raw,
      reserve1Raw: extracted.reserve1Raw,
      reserve0Scaled: extracted.reserve0Scaled,
      reserve1Scaled: extracted.reserve1Scaled,
      decodedTopics: Array.isArray(event.decodedTopics) ? event.decodedTopics : [],
      decodedValue: event.decodedValue ?? null,
    };
  });

  const eventCounts = rows.reduce(
    (acc: Record<string, number>, row: SoroswapEventRow) => {
      acc[row.eventKey] = (acc[row.eventKey] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const firstSwapRow =
    rows.find((row: SoroswapEventRow) => row.eventKey === 'SoroswapPair:swap') ?? null;

  const firstSyncRow =
    rows.find((row: SoroswapEventRow) => row.eventKey === 'SoroswapPair:sync') ?? null;

  const output = {
    generatedAt: nowIso(),
    pairId: shapePairId,
    entitySlug,
    sourceEventsCount: sourceEvents.length,
    count: rows.length,
    eventCounts,
    rows,
    firstSwapRow,
    firstSyncRow,
  };

  console.dir(
    {
      pairId: output.pairId,
      entitySlug: output.entitySlug,
      sourceEventsCount: output.sourceEventsCount,
      count: output.count,
      eventCounts: output.eventCounts,
      firstSwapRow: output.firstSwapRow,
      firstSyncRow: output.firstSyncRow,
    },
    { depth: 8 }
  );

  await saveJson('58-soroswap-active-pair-events-normalized.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});