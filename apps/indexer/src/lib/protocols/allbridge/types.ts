// apps/indexer/src/lib/protocols/allbridge/types.ts

export type AllbridgeRawEvent = {
  id: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  eventName: string | null;
  decodedTopics: unknown[];
  decodedValue: unknown;
  rawTopic?: string[];
  rawValue?: string;
  // Attribution attached only for TokensReceived (inflow) after the per-event
  // getTransaction → receive_tokens arg parse. Null if the parse failed.
  sourceChainId?: number | null;
  invocationArgs?: unknown[] | null;
};

export type AllbridgeFetchEventsResult = {
  contractId: string;
  latestLedger: number;
  startLedger: number;
  ledgerLookback: number;
  pagesFetched: number;
  cursor?: string;
  count: number;
  oldestLedger: number | null;
  newestLedger: number | null;
  topTopics: Array<{ topicKey: string; count: number }>;
  decodedEvents: AllbridgeRawEvent[];
  rpcMeta: {
    latestLedger?: number | string;
    oldestLedger?: number | string;
    latestLedgerCloseTime?: string;
    oldestLedgerCloseTime?: string;
  };
};

export type BridgeDirection = 'inflow' | 'outflow';

// One normalized bridge_flows row. amount_usd and asset_id are resolved at
// persist time (they need DB lookups), like the Soroswap adapter does.
export type BridgeFlowRow = {
  direction: BridgeDirection;
  counterpartyChainId: number | null;
  counterpartyChain: string | null;
  tokenContractId: string;
  tokenSymbol: string | null;
  decimals: number;
  amountRaw: string;
  amountScaled: string | null;
  recipient: string | null;
  nonce: string | null;
  contractAddress: string;
  eventId: string;
  txHash: string;
  ledger: number | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
};
