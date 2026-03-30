// apps/indexer/src/lib/protocols/aquarius/normalize-pool-events.ts
import {
    AquariusFetchEventsResult,
    AquariusNormalizedEventRow,
    AquariusPoolState,
  } from './types';
  
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
  
  function extractTradeRow(params: {
    event: AquariusFetchEventsResult['decodedEvents'][number];
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
    event: AquariusFetchEventsResult['decodedEvents'][number];
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
  
  export function normalizeAquariusPoolEvents(params: {
    poolState: AquariusPoolState;
    poolEvents: AquariusFetchEventsResult;
  }) {
    const { poolState, poolEvents } = params;
  
    if (poolState.poolId !== poolEvents.poolId) {
      throw new Error(
        `Mismatch between pool state and events poolId: ${poolState.poolId} !== ${poolEvents.poolId}`
      );
    }
  
    const asset0 = poolState.assets[0];
    const asset1 = poolState.assets[1];
  
    if (!asset0 || !asset1) {
      throw new Error('Missing asset0/asset1 in Aquarius pool state');
    }
  
    const decimals0 = typeof asset0.decimals === 'number' ? asset0.decimals : 7;
    const decimals1 = typeof asset1.decimals === 'number' ? asset1.decimals : 7;
  
    const sourceEvents = Array.isArray(poolEvents.decodedEvents) ? poolEvents.decodedEvents : [];
  
    const rows: AquariusNormalizedEventRow[] = sourceEvents.map((event) => {
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
          token0: poolState.token0,
          token1: poolState.token1,
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
        entitySlug: poolState.entitySlug,
        poolId: poolState.poolId,
        txHash: event.txHash ?? null,
        eventId: event.id ?? null,
        ledger: typeof event.ledger === 'number' ? event.ledger : null,
        occurredAt: event.ledgerClosedAt ?? null,
        eventName,
        subEventName,
        eventKey,
        callerAddress: extracted.callerAddress,
        token0: poolState.token0,
        token1: poolState.token1,
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
      (acc: Record<string, number>, row: AquariusNormalizedEventRow) => {
        acc[row.eventKey] = (acc[row.eventKey] ?? 0) + 1;
        return acc;
      },
      {}
    );
  
    const firstTradeRow =
      rows.find((row) => row.eventKey === 'AquariusPool:trade') ?? null;
  
    const firstReserveRow =
      rows.find((row) => row.eventKey === 'AquariusPool:update_reserves') ?? null;
  
    return {
      poolId: poolState.poolId,
      entitySlug: poolState.entitySlug,
      sourceEventsCount: sourceEvents.length,
      count: rows.length,
      eventCounts,
      rows,
      firstTradeRow,
      firstReserveRow,
    };
  }