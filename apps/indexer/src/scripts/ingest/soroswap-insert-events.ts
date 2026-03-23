import 'dotenv/config';

import { loadJson, nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import {
  getAssetIdByContractMap,
  getEntityBySlugOrThrow,
  getVenueBySlugOrThrow,
} from '../shared/lookup';

async function main() {
  const eventsFile = await loadJson<any>('58-soroswap-active-pair-events-normalized.json');
  const registry = await loadJson<any>('59-soroswap-final-registry.json');

  if (!eventsFile || !registry) {
    throw new Error('Missing 58 or 59 Soroswap files');
  }

  const registryEntitySlug = registry.pair?.entitySlug;
  const registryPairId = registry.pair?.pairId;

  if (!registryEntitySlug) {
    throw new Error('Missing entitySlug in 59-soroswap-final-registry.json');
  }

  if (!registryPairId) {
    throw new Error('Missing pairId in 59-soroswap-final-registry.json');
  }

  if (!eventsFile.entitySlug) {
    throw new Error('Missing entitySlug in 58-soroswap-active-pair-events-normalized.json');
  }

  if (!eventsFile.pairId) {
    throw new Error('Missing pairId in 58-soroswap-active-pair-events-normalized.json');
  }

  if (eventsFile.entitySlug !== registryEntitySlug) {
    throw new Error(
      `Mismatch between 58 and 59 entitySlug: ${eventsFile.entitySlug} !== ${registryEntitySlug}`
    );
  }

  if (eventsFile.pairId !== registryPairId) {
    throw new Error(`Mismatch between 58 and 59 pairId: ${eventsFile.pairId} !== ${registryPairId}`);
  }

  const entitySlug = registryEntitySlug;

  const client = createPgClient();
  await client.connect();

  try {
    const venue = await getVenueBySlugOrThrow(client, 'soroswap');
    const entity = await getEntityBySlugOrThrow(client, entitySlug);
    const assetIdByContract = await getAssetIdByContractMap(client, 'stellar-mainnet');

    let processed = 0;

    for (const row of eventsFile.rows ?? []) {
      if (row.entitySlug !== entitySlug) {
        throw new Error(
          `Row entitySlug mismatch inside 58 file: ${row.entitySlug} !== ${entitySlug}`
        );
      }

      if (row.pairId !== registryPairId) {
        throw new Error(`Row pairId mismatch inside 58 file: ${row.pairId} !== ${registryPairId}`);
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
          row.pairId,
          row.eventId,
          row.txHash,
          row.ledger,
          row.occurredAt,
          row.eventName,
          row.subEventName,
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
            source: '58-soroswap-active-pair-events-normalized',
            reserve0Raw: row.reserve0Raw ?? null,
            reserve1Raw: row.reserve1Raw ?? null,
          }),
        ]
      );

      processed += 1;
    }

    console.log({
      completedAt: nowIso(),
      entitySlug,
      processed,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});