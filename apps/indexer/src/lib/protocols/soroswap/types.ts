// app/indexer/src/lib/protocols/soroswap/types.ts
export type SoroswapAsset = {
    contractId: string;
    name: string | null;
    symbol: string | null;
    decimals: number;
  };
  
  export type SoroswapPairState = {
    venueSlug: 'soroswap';
    entityType: 'amm_pool';
    entitySlug: string;
    pairId: string;
    pairName: string | null;
    pairSymbol: string | null;
    token0: string;
    token1: string;
    reservesRaw: [string, string];
    assets: [SoroswapAsset, SoroswapAsset];
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
  
  export type SoroswapRawEvent = {
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
  
  export type SoroswapFetchEventsResult = {
    pairId: string;
    latestLedger: number;
    startLedger: number;
    ledgerLookback: number;
    pagesFetched: number;
    cursor?: string;
    count: number;
    oldestLedger: number | null;
    newestLedger: number | null;
    firstDecodedEvent: SoroswapRawEvent | null;
    lastDecodedEvent: SoroswapRawEvent | null;
    topTopics: Array<{
      topicKey: string;
      count: number;
    }>;
    decodedEvents: SoroswapRawEvent[];
    rpcMeta: {
      latestLedger?: number | string;
      oldestLedger?: number | string;
      latestLedgerCloseTime?: string;
      oldestLedgerCloseTime?: string;
    };
  };
  
  export type SoroswapNormalizedEventRow = {
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
  
  export type SoroswapPairMetrics = {
    tvlUsd: number;
    volume24hUsd: number;
    fees24hUsd: number;
    swaps24h: number;
    reserveBreakdown: Array<{
      assetId: string;
      symbol: string | null;
      name: string | null;
      reserve: number;
      priceUsd: number | null;
      reserveUsd: number | null;
    }>;
  };