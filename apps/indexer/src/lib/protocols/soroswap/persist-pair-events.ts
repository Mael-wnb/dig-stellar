import { Client } from 'pg';
import { SoroswapNormalizedEventRow } from './types';
import {
  getAssetIdByContractMap,
  getEntityBySlugOrThrow,
  getVenueBySlugOrThrow,
} from '../../../scripts/shared/lookup';

export async function persistSoroswapPairEvents(params: {
  client: Client;
  entitySlug: string;
  expectedPairId: string;
  rows: SoroswapNormalizedEventRow[];
}) {
  const { client, entitySlug, expectedPairId, rows } = params;

  if (!rows.length) {
    throw new Error('No Soroswap normalized rows to persist');
  }

  for (const row of rows) {
    if (row.entitySlug !== entitySlug) {
      throw new Error(`Row entitySlug mismatch: ${row.entitySlug} !== ${entitySlug}`);
    }

    if (row.pairId !== expectedPairId) {
      throw new Error(`Row pairId mismatch: ${row.pairId} !== ${expectedPairId}`);
    }
  }

  const venue = await getVenueBySlugOrThrow(client, 'soroswap');
  const entity = await getEntityBySlugOrThrow(client, entitySlug);
  const assetIdByContract = await getAssetIdByContractMap(client, 'stellar-mainnet');

  let processed = 0;

  for (const row of rows) {
    if (!row.eventId || !row.txHash || !row.occurredAt || !row.eventKey) {
      continue;
    }

    await client.query(
      `
      insert into normalized_events (
        venue_id,
        entity_id,
        contract_address,
        event_id,
        tx_hash,
        ledger,
        occurred_at,
        event_name,
        sub_event_name,
        event_key,
        caller_address,
        token_in_asset_id,
        token_out_asset_id,
        token_amount_in_raw,
        token_amount_out_raw,
        token_amount_in_scaled,
        token_amount_out_scaled,
        in_successful_contract_call,
        metadata
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17,$18,$19::jsonb
      )
      on conflict (contract_address, event_id)
      do update set
        venue_id = excluded.venue_id,
        entity_id = excluded.entity_id,
        contract_address = excluded.contract_address,
        tx_hash = excluded.tx_hash,
        ledger = excluded.ledger,
        occurred_at = excluded.occurred_at,
        event_name = excluded.event_name,
        sub_event_name = excluded.sub_event_name,
        event_key = excluded.event_key,
        caller_address = excluded.caller_address,
        token_in_asset_id = excluded.token_in_asset_id,
        token_out_asset_id = excluded.token_out_asset_id,
        token_amount_in_raw = excluded.token_amount_in_raw,
        token_amount_out_raw = excluded.token_amount_out_raw,
        token_amount_in_scaled = excluded.token_amount_in_scaled,
        token_amount_out_scaled = excluded.token_amount_out_scaled,
        in_successful_contract_call = excluded.in_successful_contract_call,
        metadata = excluded.metadata
      `,
      [
        venue.id,
        entity.id,
        expectedPairId,
        row.eventId,
        row.txHash,
        row.ledger ?? null,
        row.occurredAt,
        row.eventName ?? null,
        row.subEventName ?? null,
        row.eventKey,
        null,
        row.tokenIn ? assetIdByContract.get(row.tokenIn) ?? null : null,
        row.tokenOut ? assetIdByContract.get(row.tokenOut) ?? null : null,
        row.tokenAmountInRaw ?? null,
        row.tokenAmountOutRaw ?? null,
        row.tokenAmountInScaled ?? null,
        row.tokenAmountOutScaled ?? null,
        true,
        JSON.stringify({
          source: 'lib/protocols/soroswap/persist-pair-events',
          entitySlug,
          reserve0Raw: row.reserve0Raw ?? null,
          reserve1Raw: row.reserve1Raw ?? null,
        }),
      ]
    );

    processed += 1;
  }

  return {
    entitySlug,
    expectedPairId,
    processed,
  };
}