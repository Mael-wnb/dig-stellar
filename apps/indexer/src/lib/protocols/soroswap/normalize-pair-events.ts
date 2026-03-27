// app/indexer/src/lib/protocols/soroswap/normalize-pair-events.ts
import { SoroswapFetchEventsResult, SoroswapNormalizedEventRow, SoroswapPairState } from './types';

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

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return value !== undefined && value !== null ? String(value) : null;
}

function extractSwapAmounts(decodedValue: unknown) {
  const record = toRecord(decodedValue);

  const amount0In = getStringField(record, 'amount_0_in') ?? '0';
  const amount0Out = getStringField(record, 'amount_0_out') ?? '0';
  const amount1In = getStringField(record, 'amount_1_in') ?? '0';
  const amount1Out = getStringField(record, 'amount_1_out') ?? '0';

  return { amount0In, amount0Out, amount1In, amount1Out };
}

export function normalizeSoroswapPairEvents(params: {
  pairState: SoroswapPairState;
  pairEvents: SoroswapFetchEventsResult;
}) {
  const { pairState, pairEvents } = params;

  if (pairState.pairId !== pairEvents.pairId) {
    throw new Error(
      `Mismatch between pair state and events pairId: ${pairState.pairId} !== ${pairEvents.pairId}`
    );
  }

  const asset0 = pairState.assets[0];
  const asset1 = pairState.assets[1];

  if (!asset0 || !asset1) {
    throw new Error('Missing asset0/asset1 in Soroswap pair state');
  }

  const decimals0 = typeof asset0.decimals === 'number' ? asset0.decimals : 7;
  const decimals1 = typeof asset1.decimals === 'number' ? asset1.decimals : 7;

  const sourceEvents = Array.isArray(pairEvents.decodedEvents) ? pairEvents.decodedEvents : [];

  const rows: SoroswapNormalizedEventRow[] = sourceEvents.map((event) => {
    const decodedTopics = Array.isArray(event.decodedTopics) ? event.decodedTopics : [];
    const rootEventName = typeof decodedTopics[0] === 'string' ? decodedTopics[0] : null;
    const subEventName = typeof decodedTopics[1] === 'string' ? decodedTopics[1] : null;
    const decodedValueRecord = toRecord(event.decodedValue);

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
      const { amount0In, amount0Out, amount1In, amount1Out } = extractSwapAmounts(decodedValueRecord);

      if (amount0In !== '0' && amount1Out !== '0') {
        tokenIn = pairState.token0;
        tokenOut = pairState.token1;
        tokenAmountInRaw = amount0In;
        tokenAmountOutRaw = amount1Out;
        tokenAmountInScaled = scale(amount0In, decimals0);
        tokenAmountOutScaled = scale(amount1Out, decimals1);
      } else if (amount1In !== '0' && amount0Out !== '0') {
        tokenIn = pairState.token1;
        tokenOut = pairState.token0;
        tokenAmountInRaw = amount1In;
        tokenAmountOutRaw = amount0Out;
        tokenAmountInScaled = scale(amount1In, decimals1);
        tokenAmountOutScaled = scale(amount0Out, decimals0);
      }
    }

    if (subEventName === 'sync') {
      reserve0Raw = getStringField(decodedValueRecord, 'new_reserve_0');
      reserve1Raw = getStringField(decodedValueRecord, 'new_reserve_1');
      reserve0Scaled = scale(reserve0Raw, decimals0);
      reserve1Scaled = scale(reserve1Raw, decimals1);
    }

    return {
      venueSlug: 'soroswap',
      entitySlug: pairState.entitySlug,
      pairId: pairState.pairId,
      txHash: event.txHash ?? null,
      eventId: event.id ?? null,
      ledger: typeof event.ledger === 'number' ? event.ledger : null,
      occurredAt: event.ledgerClosedAt ?? null,
      eventName: rootEventName,
      subEventName,
      eventKey: subEventName
        ? `${rootEventName}:${subEventName}`
        : (rootEventName ?? 'SoroswapPair:unknown'),
      token0: pairState.token0,
      token1: pairState.token1,
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
      decodedTopics,
      decodedValue: event.decodedValue ?? null,
    };
  });

  const eventCounts = rows.reduce(
    (acc: Record<string, number>, row: SoroswapNormalizedEventRow) => {
      acc[row.eventKey] = (acc[row.eventKey] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const firstSwapRow = rows.find((row) => row.eventKey === 'SoroswapPair:swap') ?? null;
  const firstSyncRow = rows.find((row) => row.eventKey === 'SoroswapPair:sync') ?? null;

  return {
    pairId: pairState.pairId,
    entitySlug: pairState.entitySlug,
    sourceEventsCount: sourceEvents.length,
    count: rows.length,
    eventCounts,
    rows,
    firstSwapRow,
    firstSyncRow,
  };
}