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

  const envPairId = process.env.SOROSWAP_PAIR_ID ?? null;
  const shapePairId = typeof shape.pairId === 'string' ? shape.pairId : null;
  const eventsPairId = typeof pairEvents.pairId === 'string' ? pairEvents.pairId : null;

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

  const asset0 = Array.isArray(shape.assets)
    ? shape.assets.find((a: any) => a.contractId === shape.token0)
    : null;

  const asset1 = Array.isArray(shape.assets)
    ? shape.assets.find((a: any) => a.contractId === shape.token1)
    : null;

  if (!asset0 || !asset1) {
    throw new Error('Missing asset0/asset1 in 57-soroswap-active-pair-db-shape.json');
  }

  const decimals0 = typeof asset0.decimals === 'number' ? asset0.decimals : 7;
  const decimals1 = typeof asset1.decimals === 'number' ? asset1.decimals : 7;

  const sourceEvents = Array.isArray(pairEvents.decodedEvents) ? pairEvents.decodedEvents : [];

  const rows: SoroswapEventRow[] = sourceEvents.map((event: any) => {
    const decodedTopics = Array.isArray(event.decodedTopics) ? event.decodedTopics : [];
    const rootEventName = typeof decodedTopics[0] === 'string' ? decodedTopics[0] : null;
    const subEventName = typeof decodedTopics[1] === 'string' ? decodedTopics[1] : null;
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
      pairId: shapePairId,
      txHash: event.txHash ?? null,
      eventId: event.id ?? null,
      ledger: typeof event.ledger === 'number' ? event.ledger : null,
      occurredAt: event.ledgerClosedAt ?? null,
      eventName: rootEventName,
      subEventName,
      eventKey: subEventName ? `${rootEventName}:${subEventName}` : (rootEventName ?? 'SoroswapPair:unknown'),
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
      decodedTopics,
      decodedValue,
    };
  });

  const eventCounts = rows.reduce(
    (acc: Record<string, number>, row: SoroswapEventRow) => {
      acc[row.eventKey] = (acc[row.eventKey] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const firstSwapRow =
    rows.find((row) => row.eventKey === 'SoroswapPair:swap') ?? null;

  const firstSyncRow =
    rows.find((row) => row.eventKey === 'SoroswapPair:sync') ?? null;

  const output = {
    generatedAt: nowIso(),
    pairId: shapePairId,
    entitySlug: shape.entitySlug,
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