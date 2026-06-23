// apps/indexer/src/lib/protocols/allbridge/fetch-bridge-events.ts
import 'dotenv/config';

import {
  Address,
  Networks,
  TransactionBuilder,
  scValToNative,
} from '@stellar/stellar-sdk';

import {
  decodeScValBase64,
  decodeTopicList,
  deepNormalizeDecoded,
  rpcCall,
  tryExtractEventName,
} from '../../../scripts/discovery/00-common';
import { resolveRpcUrl } from '../../rpc-config';
import {
  ALLBRIDGE_BRIDGE_CONTRACT_ID,
  ALLBRIDGE_EVENT_TOKENS_RECEIVED,
  ALLBRIDGE_RECEIVE_TOKENS_FN,
  ALLBRIDGE_RECEIVE_TOKENS_SOURCE_CHAIN_ARG_INDEX,
} from './constants';
import { AllbridgeFetchEventsResult, AllbridgeRawEvent } from './types';

type RpcEnvelope<T> = {
  jsonrpc: '2.0';
  id: string;
  result?: T;
  error?: unknown;
};

type RpcEvent = {
  id: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  topic?: string[];
  value?: string;
};

type GetEventsResult = {
  events?: RpcEvent[];
  cursor?: string;
  latestLedger?: number | string;
  oldestLedger?: number | string;
  latestLedgerCloseTime?: string;
  oldestLedgerCloseTime?: string;
};

type GetTransactionResult = {
  status?: string;
  envelopeXdr?: string;
};

/**
 * Pull `source_chain_id` out of the `receive_tokens(...)` invocation that
 * produced a TokensReceived event. The event itself carries no source chain
 * (only the message buffer), so we read the host-function call args.
 *
 * The arg order is fixed by the contract (see
 * ALLBRIDGE_RECEIVE_TOKENS_SOURCE_CHAIN_ARG_INDEX): source_chain_id is a u32 at
 * index 3, which scValToNative decodes to a JS `number`. We read that index
 * behind a numeric type guard and pass the raw value through — resolveChain
 * keeps the Unknown(N) fallback for any chain not yet in the map. If the arg is
 * missing or not numeric we return null and the caller falls back to "Unknown"
 * rather than dropping the inflow.
 */
async function fetchSourceChainId(params: {
  rpcUrl: string;
  txHash: string;
  bridgeContractId: string;
  verbose?: boolean;
}): Promise<{ sourceChainId: number | null; args: unknown[] | null }> {
  const { rpcUrl, txHash, bridgeContractId, verbose } = params;

  let envelopeXdr: string | undefined;
  try {
    const resp = await rpcCall<RpcEnvelope<GetTransactionResult>>(rpcUrl, 'getTransaction', {
      hash: txHash,
    });
    envelopeXdr = resp.result?.envelopeXdr;
  } catch (err) {
    if (verbose) console.warn(`getTransaction failed for ${txHash}:`, err);
    return { sourceChainId: null, args: null };
  }

  if (!envelopeXdr) return { sourceChainId: null, args: null };

  let operations: ReadonlyArray<{ type: string; func?: unknown }> = [];
  try {
    const tx = TransactionBuilder.fromXDR(envelopeXdr, Networks.PUBLIC);
    operations =
      'innerTransaction' in tx
        ? (tx.innerTransaction.operations as typeof operations)
        : (tx.operations as typeof operations);
  } catch (err) {
    if (verbose) console.warn(`Could not parse envelope for ${txHash}:`, err);
    return { sourceChainId: null, args: null };
  }

  for (const op of operations) {
    if (op.type !== 'invokeHostFunction') continue;

    const func = op.func as {
      switch: () => { name: string };
      invokeContract: () => {
        contractAddress: () => unknown;
        functionName: () => { toString: () => string };
        args: () => unknown[];
      };
    };

    if (func.switch().name !== 'hostFunctionTypeInvokeContract') continue;

    const invoke = func.invokeContract();
    let contractAddress: string;
    try {
      contractAddress = Address.fromScAddress(invoke.contractAddress() as never).toString();
    } catch {
      continue;
    }

    const fnName = invoke.functionName().toString();
    if (contractAddress !== bridgeContractId) continue;
    if (fnName !== ALLBRIDGE_RECEIVE_TOKENS_FN) continue;

    const args = invoke.args().map((a) => deepNormalizeDecoded(scValToNative(a as never)));

    // Read the fixed source_chain_id position (u32 -> number). Pass the raw
    // value straight through; resolveChain handles unknown chains as Unknown(N).
    const raw = args[ALLBRIDGE_RECEIVE_TOKENS_SOURCE_CHAIN_ARG_INDEX];
    const sourceChainId = typeof raw === 'number' && Number.isInteger(raw) ? raw : null;

    return { sourceChainId, args };
  }

  return { sourceChainId: null, args: null };
}

export async function fetchAllbridgeBridgeEvents(params?: {
  contractId?: string;
  rpcUrl?: string;
  ledgerLookback?: number;
  startLedger?: number;
  limit?: number;
  maxPages?: number;
  verbose?: boolean;
}): Promise<AllbridgeFetchEventsResult> {
  const rpcUrl = resolveRpcUrl(params?.rpcUrl);
  const contractId = params?.contractId ?? ALLBRIDGE_BRIDGE_CONTRACT_ID;
  const verbose = params?.verbose ?? process.env.VERBOSE === '1';

  const latestLedgerResp = await rpcCall<RpcEnvelope<{ sequence: number | string }>>(
    rpcUrl,
    'getLatestLedger'
  );
  const latestLedger = Number(latestLedgerResp.result?.sequence);
  if (!Number.isFinite(latestLedger)) {
    throw new Error('Could not retrieve latest ledger');
  }

  const ledgerLookback = params?.ledgerLookback ?? Number(process.env.LEDGER_LOOKBACK ?? 5000);
  const startLedger =
    params?.startLedger ?? Number(process.env.START_LEDGER ?? latestLedger - ledgerLookback);
  const limit = params?.limit ?? Number(process.env.EVENTS_LIMIT ?? 200);
  const maxPages = params?.maxPages ?? Number(process.env.MAX_EVENT_PAGES ?? 20);

  const allEvents: RpcEvent[] = [];
  let cursor: string | undefined;
  let pagesFetched = 0;
  let responseMeta: Partial<GetEventsResult> = {};

  while (pagesFetched < maxPages) {
    const rpcParams =
      pagesFetched === 0
        ? { startLedger, filters: [{ contractIds: [contractId] }], pagination: { limit } }
        : { filters: [{ contractIds: [contractId] }], pagination: { cursor, limit } };

    const resp = await rpcCall<RpcEnvelope<GetEventsResult>>(rpcUrl, 'getEvents', rpcParams);

    if (resp.error) {
      throw new Error(
        `getEvents returned error on page ${pagesFetched + 1}: ${
          typeof resp.error === 'string' ? resp.error : JSON.stringify(resp.error)
        }`
      );
    }

    const result = resp.result;
    if (!result) {
      throw new Error(`Missing result on getEvents page ${pagesFetched + 1}`);
    }

    const pageEvents = Array.isArray(result.events) ? result.events : [];

    if (pagesFetched === 0) {
      responseMeta = {
        latestLedger: result.latestLedger,
        oldestLedger: result.oldestLedger,
        latestLedgerCloseTime: result.latestLedgerCloseTime,
        oldestLedgerCloseTime: result.oldestLedgerCloseTime,
      };
    }

    allEvents.push(...pageEvents);
    pagesFetched += 1;

    const nextCursor = typeof result.cursor === 'string' ? result.cursor : undefined;

    if (verbose) {
      console.log({
        page: pagesFetched,
        pageEvents: pageEvents.length,
        nextCursor,
      });
    }

    if (!nextCursor || pageEvents.length === 0 || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  const decodedEvents: AllbridgeRawEvent[] = allEvents.map((event) => {
    const decodedTopics = decodeTopicList(event.topic ?? []);
    const decodedValue = decodeScValBase64(event.value);
    const eventName = tryExtractEventName(decodedTopics);

    return {
      id: event.id,
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt,
      txHash: event.txHash,
      eventName,
      decodedTopics,
      decodedValue,
      rawTopic: event.topic,
      rawValue: event.value,
    };
  });

  // For each inflow (TokensReceived), resolve its source chain via the
  // receive_tokens invocation. One extra getTransaction per inflow — volume is
  // low so this is negligible. Outflows need no extra call.
  for (const event of decodedEvents) {
    if (event.eventName !== ALLBRIDGE_EVENT_TOKENS_RECEIVED || !event.txHash) continue;

    const { sourceChainId, args } = await fetchSourceChainId({
      rpcUrl,
      txHash: event.txHash,
      bridgeContractId: contractId,
      verbose,
    });

    event.sourceChainId = sourceChainId;
    event.invocationArgs = args;
  }

  const topicStats = new Map<string, number>();
  for (const event of decodedEvents) {
    const topicKey = Array.isArray(event.decodedTopics)
      ? event.decodedTopics.map((v) => String(v)).join(' | ')
      : 'unknown';
    topicStats.set(topicKey, (topicStats.get(topicKey) ?? 0) + 1);
  }
  const topTopics = Array.from(topicStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([topicKey, count]) => ({ topicKey, count }));

  const ledgers = decodedEvents
    .map((event) => Number(event.ledger))
    .filter((value) => Number.isFinite(value));

  return {
    contractId,
    latestLedger,
    startLedger,
    ledgerLookback,
    pagesFetched,
    cursor,
    count: decodedEvents.length,
    oldestLedger: ledgers.length ? Math.min(...ledgers) : null,
    newestLedger: ledgers.length ? Math.max(...ledgers) : null,
    topTopics,
    decodedEvents,
    rpcMeta: responseMeta,
  };
}
