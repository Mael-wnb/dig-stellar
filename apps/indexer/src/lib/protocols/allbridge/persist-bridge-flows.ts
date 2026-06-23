import type { Client, PoolClient } from 'pg';
import { getAssetIdByContractMap, getVenueBySlugOrThrow } from '../../../scripts/shared/lookup';
import { getLatestAssetPricesMap, inferStablePrice } from '../../../scripts/shared/prices';
import { ALLBRIDGE_VENUE_SLUG } from './constants';
import { BridgeFlowRow } from './types';

type DbClient = Pick<Client | PoolClient, 'query'>;

export async function persistAllbridgeBridgeFlows(params: {
  client: Client | PoolClient;
  rows: BridgeFlowRow[];
}) {
  const { client, rows } = params;

  const venue = await getVenueBySlugOrThrow(client, ALLBRIDGE_VENUE_SLUG);
  const assetIdByContract = await getAssetIdByContractMap(client as DbClient, 'stellar-mainnet');
  const pricesByAssetId = await getLatestAssetPricesMap(client as Client);

  let processed = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.eventId || !row.txHash || !row.occurredAt) {
      skipped += 1;
      continue;
    }

    const assetId = assetIdByContract.get(row.tokenContractId) ?? null;

    // USDC: prefer a fresh asset_prices row, else fall back to the stable $1
    // peg, else 1. amount_usd is null only when we have no scaled amount.
    const priceUsd =
      (assetId ? pricesByAssetId.get(assetId) : undefined) ??
      inferStablePrice(row.tokenSymbol ?? '') ??
      1;

    const amountUsd =
      row.amountScaled !== null && Number.isFinite(Number(row.amountScaled))
        ? Number(row.amountScaled) * priceUsd
        : null;

    const res = await client.query(
      `
      insert into bridge_flows (
        venue_id,
        direction,
        counterparty_chain_id,
        counterparty_chain,
        asset_id,
        token_contract_id,
        token_symbol,
        amount_raw,
        amount_scaled,
        amount_usd,
        recipient,
        nonce,
        contract_address,
        event_id,
        tx_hash,
        ledger,
        occurred_at,
        metadata
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb
      )
      on conflict (contract_address, event_id) do nothing
      `,
      [
        venue.id,
        row.direction,
        row.counterpartyChainId,
        row.counterpartyChain,
        assetId,
        row.tokenContractId,
        row.tokenSymbol,
        row.amountRaw,
        row.amountScaled,
        amountUsd,
        row.recipient,
        row.nonce,
        row.contractAddress,
        row.eventId,
        row.txHash,
        row.ledger,
        row.occurredAt,
        JSON.stringify(row.metadata ?? {}),
      ]
    );

    if (res.rowCount && res.rowCount > 0) {
      processed += 1;
    } else {
      skipped += 1;
    }
  }

  return { processed, skipped, total: rows.length };
}
