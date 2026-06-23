// apps/indexer/src/lib/protocols/allbridge/normalize-bridge-events.ts
import {
  ALLBRIDGE_BRIDGE_CONTRACT_ID,
  ALLBRIDGE_EVENT_TOKENS_RECEIVED,
  ALLBRIDGE_EVENT_TOKENS_SENT,
  ALLBRIDGE_SYSTEM_PRECISION,
  ALLBRIDGE_USDC_CONTRACT_ID,
  ALLBRIDGE_USDC_DECIMALS,
  ALLBRIDGE_USDC_SYMBOL,
} from './constants';
import { resolveChain } from './chains';
import { AllbridgeFetchEventsResult, AllbridgeRawEvent, BridgeFlowRow } from './types';

// raw on-chain units (string) -> human-scaled decimal string. Mirrors the
// Soroswap adapter's scale().
function scale(raw: string | null | undefined, decimals: number): string | null {
  if (raw === null || raw === undefined || raw === '') return null;

  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return null;
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

function getNumberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Inflow recipient is a Stellar Address (decodes to a 'G...'/'C...' string).
// Outflow recipient is a foreign-chain byte address (decodes to something
// non-string); keep only clean strings, stash the rest in metadata.
function coerceRecipient(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function normalizeAllbridgeBridgeEvents(params: {
  bridgeEvents: AllbridgeFetchEventsResult;
  contractId?: string;
}): {
  contractId: string;
  sourceEventsCount: number;
  count: number;
  eventCounts: Record<string, number>;
  rows: BridgeFlowRow[];
} {
  const contractId = params.contractId ?? params.bridgeEvents.contractId ?? ALLBRIDGE_BRIDGE_CONTRACT_ID;
  const sourceEvents = Array.isArray(params.bridgeEvents.decodedEvents)
    ? params.bridgeEvents.decodedEvents
    : [];

  const rows: BridgeFlowRow[] = [];

  for (const event of sourceEvents as AllbridgeRawEvent[]) {
    const isOutflow = event.eventName === ALLBRIDGE_EVENT_TOKENS_SENT;
    const isInflow = event.eventName === ALLBRIDGE_EVENT_TOKENS_RECEIVED;
    if (!isOutflow && !isInflow) continue;
    if (!event.id || !event.txHash || !event.ledgerClosedAt) continue;

    const value = toRecord(event.decodedValue);

    // Outflow carries destination_chain_id as a named event field.
    // Inflow's source chain was attached in fetch via the receive_tokens parse.
    const counterpartyChainId = isOutflow
      ? getNumberField(value, 'destination_chain_id')
      : event.sourceChainId ?? null;

    const resolved = resolveChain(counterpartyChainId);

    // amount_raw is in mixed precision: inflow (TokensReceived) is in the USDC
    // SAC's native 7 decimals, outflow (TokensSent) is in Allbridge's 3-decimal
    // system precision. Pick the divisor accordingly — a single global divisor
    // would over-scale every outflow by 10^4.
    const scaleDecimals = isOutflow ? ALLBRIDGE_SYSTEM_PRECISION : ALLBRIDGE_USDC_DECIMALS;
    const amountRaw = getStringField(value, 'amount') ?? '0';
    const amountScaled = scale(amountRaw, scaleDecimals);

    rows.push({
      direction: isOutflow ? 'outflow' : 'inflow',
      counterpartyChainId,
      counterpartyChain: resolved.symbol,
      // Mono-token: the bridged asset on Stellar is always the USDC SAC. The
      // `receive_token` event field is the destination-chain token, not a
      // Stellar contract, so we do not use it here.
      tokenContractId: ALLBRIDGE_USDC_CONTRACT_ID,
      tokenSymbol: ALLBRIDGE_USDC_SYMBOL,
      // Precision of amount_raw for THIS row (7 native on inflow, 3 system on
      // outflow) — kept self-consistent with the divisor used above.
      decimals: scaleDecimals,
      amountRaw,
      amountScaled,
      recipient: coerceRecipient(value.recipient),
      nonce: getStringField(value, 'nonce'),
      contractAddress: contractId,
      eventId: event.id,
      txHash: event.txHash,
      ledger: typeof event.ledger === 'number' ? event.ledger : null,
      occurredAt: event.ledgerClosedAt,
      metadata: {
        source: 'lib/protocols/allbridge/normalize-bridge-events',
        eventName: event.eventName,
        counterpartyChainName: resolved.name,
        attributionResolved: counterpartyChainId !== null,
        rawRecipient: typeof value.recipient === 'string' ? undefined : value.recipient ?? null,
        receiveToken: value.receive_token ?? null,
        invocationArgs: event.invocationArgs ?? null,
      },
    });
  }

  const eventCounts = rows.reduce((acc: Record<string, number>, row) => {
    acc[row.direction] = (acc[row.direction] ?? 0) + 1;
    return acc;
  }, {});

  return {
    contractId,
    sourceEventsCount: sourceEvents.length,
    count: rows.length,
    eventCounts,
    rows,
  };
}
