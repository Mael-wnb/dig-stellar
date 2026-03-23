// src/scripts/discovery/58-aquarius-active-pool-events-normalized.ts
import { loadJson, nowIso, saveJson } from './00-common';

type AquariusEventRow = {
  venueSlug: 'aquarius';
  entitySlug: string;
  poolId: string;
  txHash: string | null;
  eventId: string | null;
  ledger: number | null;
  occurredAt: string | null;
  eventName: string | null;
  subEventName: string | null;
  eventKey: string;
  callerAddress: string | null;
  token0: string;
  token1: string;
  tokenIn: string | null;
  tokenOut: string | null;
  tokenAmountInRaw: string | null;
  tokenAmountOutRaw: string | null;
  tokenAmountInScaled: string | null;
  tokenAmountOutScaled: string | null;
  feeAmountRaw: string | null;
  feeAmountScaled: string | null;
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

function getPoolIdFrom50(eventsFile: unknown): string | null {
  if (!eventsFile || typeof eventsFile !== 'object') return null;
  const poolId = (eventsFile as { poolId?: unknown }).poolId;
  return typeof poolId === 'string' ? poolId : null;
}

function getPoolIdFrom57(shape: unknown): string | null {
  if (!shape || typeof shape !== 'object') return null;
  const poolId = (shape as { poolId?: unknown }).poolId;
  return typeof poolId === 'string' ? poolId : null;
}

function getEntitySlugFrom57(shape: unknown): string {
  if (!shape || typeof shape !== 'object') {
    throw new Error('Missing 57-aquarius-active-pool-db-shape.json');
  }

  const entitySlug = (shape as { entitySlug?: unknown }).entitySlug;
  if (!entitySlug || typeof entitySlug !== 'string') {
    throw new Error('Missing entitySlug in 57-aquarius-active-pool-db-shape.json');
  }

  return entitySlug;
}

function extractTradeRow(params: {
  event: any;
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
}) {
  const { event, token0, token1, decimals0, decimals1 } = params;

  const topics = Array.isArray(event.decodedTopics) ? event.decodedTopics : [];
  const decodedValue = Array.isArray(event.decodedValue) ? event.decodedValue : [];

  const tokenIn = typeof topics[1] === 'string' ? topics[1] : null;
  const tokenOut = typeof topics[2] === 'string' ? topics[2] : null;
  const callerAddress = typeof topics[3] === 'string' ? topics[3] : null;

  const tokenAmountInRaw = decodedValue[0] !== undefined ? String(decodedValue[0]) : null;
  const tokenAmountOutRaw = decodedValue[1] !== undefined ? String(decodedValue[1]) : null;
  const feeAmountRaw = decodedValue[2] !== undefined ? String(decodedValue[2]) : null;

  const inDecimals =
    tokenIn === token0 ? decimals0 :
    tokenIn === token1 ? decimals1 :
    null;

  const outDecimals =
    tokenOut === token0 ? decimals0 :
    tokenOut === token1 ? decimals1 :
    null;

  return {
    callerAddress,
    tokenIn,
    tokenOut,
    tokenAmountInRaw,
    tokenAmountOutRaw,
    tokenAmountInScaled: scale(tokenAmountInRaw, inDecimals),
    tokenAmountOutScaled: scale(tokenAmountOutRaw, outDecimals),
    feeAmountRaw,
    feeAmountScaled: scale(feeAmountRaw, inDecimals),
    reserve0Raw: null,
    reserve1Raw: null,
    reserve0Scaled: null,
    reserve1Scaled: null,
  };
}

function extractUpdateReservesRow(params: {
  event: any;
  decimals0: number;
  decimals1: number;
}) {
  const { event, decimals0, decimals1 } = params;
  const decodedValue = Array.isArray(event.decodedValue) ? event.decodedValue : [];

  const reserve0Raw = decodedValue[0] !== undefined ? String(decodedValue[0]) : null;
  const reserve1Raw = decodedValue[1] !== undefined ? String(decodedValue[1]) : null;

  return {
    callerAddress: null,
    tokenIn: null,
    tokenOut: null,
    tokenAmountInRaw: null,
    tokenAmountOutRaw: null,
    tokenAmountInScaled: null,
    tokenAmountOutScaled: null,
    feeAmountRaw: null,
    feeAmountScaled: null,
    reserve0Raw,
    reserve1Raw,
    reserve0Scaled: scale(reserve0Raw, decimals0),
    reserve1Scaled: scale(reserve1Raw, decimals1),
  };
}

async function main() {
  // src/scripts/discovery/57-aquarius-active-pool-db-shape.ts
  const shape = await loadJson<any>('57-aquarius-active-pool-db-shape.json');

  // src/scripts/discovery/50-aquarius-pool-events.ts
  const eventsFile = await loadJson<any>('50-aquarius-pool-events.json');

  if (!shape) {
    throw new Error('Missing 57-aquarius-active-pool-db-shape.json');
  }

  if (!eventsFile) {
    throw new Error('Missing 50-aquarius-pool-events.json');
  }

  const envPoolId = process.env.AQUARIUS_POOL_ID ?? null;
  const shapePoolId = getPoolIdFrom57(shape);
  const eventsPoolId = getPoolIdFrom50(eventsFile);

  if (!shapePoolId) {
    throw new Error('Missing poolId in 57-aquarius-active-pool-db-shape.json');
  }

  if (!eventsPoolId) {
    throw new Error('Missing poolId in 50-aquarius-pool-events.json');
  }

  if (envPoolId && shapePoolId !== envPoolId) {
    throw new Error(`Mismatch between AQUARIUS_POOL_ID and 57 poolId: ${envPoolId} !== ${shapePoolId}`);
  }

  if (envPoolId && eventsPoolId !== envPoolId) {
    throw new Error(`Mismatch between AQUARIUS_POOL_ID and 50 poolId: ${envPoolId} !== ${eventsPoolId}`);
  }

  if (eventsPoolId !== shapePoolId) {
    throw new Error(`Mismatch between 50 and 57 poolId: ${eventsPoolId} !== ${shapePoolId}`);
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
    throw new Error('Missing asset0/asset1 in 57-aquarius-active-pool-db-shape.json');
  }

  const decimals0 = typeof asset0.decimals === 'number' ? asset0.decimals : 7;
  const decimals1 = typeof asset1.decimals === 'number' ? asset1.decimals : 7;

  const sourceEvents = Array.isArray(eventsFile.decodedEvents) ? eventsFile.decodedEvents : [];

  const rows: AquariusEventRow[] = sourceEvents.map((event: any) => {
    const eventName = typeof event.eventName === 'string' ? event.eventName : null;
    const subEventName = eventName;
    const eventKey = eventName ? `AquariusPool:${eventName}` : 'AquariusPool:unknown';

    let extracted = {
      callerAddress: null as string | null,
      tokenIn: null as string | null,
      tokenOut: null as string | null,
      tokenAmountInRaw: null as string | null,
      tokenAmountOutRaw: null as string | null,
      tokenAmountInScaled: null as string | null,
      tokenAmountOutScaled: null as string | null,
      feeAmountRaw: null as string | null,
      feeAmountScaled: null as string | null,
      reserve0Raw: null as string | null,
      reserve1Raw: null as string | null,
      reserve0Scaled: null as string | null,
      reserve1Scaled: null as string | null,
    };

    if (eventName === 'trade') {
      extracted = extractTradeRow({
        event,
        token0,
        token1,
        decimals0,
        decimals1,
      });
    } else if (eventName === 'update_reserves') {
      extracted = extractUpdateReservesRow({
        event,
        decimals0,
        decimals1,
      });
    }

    return {
      venueSlug: 'aquarius',
      entitySlug,
      poolId: shapePoolId,
      txHash: event.txHash ?? null,
      eventId: event.id ?? null,
      ledger: typeof event.ledger === 'number' ? event.ledger : null,
      occurredAt: event.ledgerClosedAt ?? null,
      eventName,
      subEventName,
      eventKey,
      callerAddress: extracted.callerAddress,
      token0,
      token1,
      tokenIn: extracted.tokenIn,
      tokenOut: extracted.tokenOut,
      tokenAmountInRaw: extracted.tokenAmountInRaw,
      tokenAmountOutRaw: extracted.tokenAmountOutRaw,
      tokenAmountInScaled: extracted.tokenAmountInScaled,
      tokenAmountOutScaled: extracted.tokenAmountOutScaled,
      feeAmountRaw: extracted.feeAmountRaw,
      feeAmountScaled: extracted.feeAmountScaled,
      reserve0Raw: extracted.reserve0Raw,
      reserve1Raw: extracted.reserve1Raw,
      reserve0Scaled: extracted.reserve0Scaled,
      reserve1Scaled: extracted.reserve1Scaled,
      decodedTopics: Array.isArray(event.decodedTopics) ? event.decodedTopics : [],
      decodedValue: event.decodedValue ?? null,
    };
  });

  const eventCounts = rows.reduce(
    (acc: Record<string, number>, row: AquariusEventRow) => {
      acc[row.eventKey] = (acc[row.eventKey] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const firstTradeRow =
    rows.find((row: AquariusEventRow) => row.eventKey === 'AquariusPool:trade') ?? null;

  const firstReserveRow =
    rows.find((row: AquariusEventRow) => row.eventKey === 'AquariusPool:update_reserves') ?? null;

  const output = {
    generatedAt: nowIso(),
    poolId: shapePoolId,
    entitySlug,
    sourceEventsCount: sourceEvents.length,
    count: rows.length,
    eventCounts,
    rows,
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