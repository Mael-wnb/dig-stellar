// apps/indexer/src/lib/protocols/aquarius/types.ts
export type AquariusAsset = {
    contractId: string;
    name: string | null;
    symbol: string | null;
    decimals: number;
  };
  
  export type AquariusPoolState = {
    venueSlug: 'aquarius';
    entityType: 'amm_pool';
    entitySlug: string;
    poolId: string;
    poolName: string;
    token0: string;
    token1: string;
    reservesRaw: [string, string];
    info: unknown;
    assets: [AquariusAsset, AquariusAsset];
    reserveRows: [
      {
        contractId: string;
        symbol: string | null;
        name: string | null;
        decimals: number;
        reserveRaw: string;
        reserveScaled: string | null;
      },
      {
        contractId: string;
        symbol: string | null;
        name: string | null;
        decimals: number;
        reserveRaw: string;
        reserveScaled: string | null;
      },
    ];
  };
  
  export type AquariusRawEvent = {
    id: string;
    ledger: number;
    ledgerClosedAt: string;
    txHash: string;
    eventName: string | null;
    decodedTopics: unknown[];
    decodedValue: unknown;
    rawTopic?: string[];
    rawValue?: string;
  };
  
  export type AquariusFetchEventsResult = {
    poolId: string;
    latestLedger: number;
    startLedger: number;
    ledgerLookback: number;
    pagesFetched: number;
    cursor?: string;
    count: number;
    oldestLedger: number | null;
    newestLedger: number | null;
    firstDecodedEvent: AquariusRawEvent | null;
    lastDecodedEvent: AquariusRawEvent | null;
    topTopics: Array<{
      topicKey: string;
      count: number;
    }>;
    decodedEvents: AquariusRawEvent[];
    rpcMeta: {
      latestLedger?: number | string;
      oldestLedger?: number | string;
      latestLedgerCloseTime?: string;
      oldestLedgerCloseTime?: string;
    };
  };
  
  export type AquariusNormalizedEventRow = {
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
  
  export type AquariusPoolMetrics = {
    tvlUsd: number;
    volume24hUsd: number;
    fees24hUsd: number;
    swaps24h: number;
  };