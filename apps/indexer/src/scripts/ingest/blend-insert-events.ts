import { loadJson, nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { getAssetIdByContractMap, getEntityBySlugOrThrow, getVenueBySlugOrThrow } from '../shared/lookup';

async function main() {
  const eventsFile = await loadJson<any>('28-blend-events-scaled.json');
  if (!eventsFile) {
    throw new Error('Missing 28-blend-events-scaled.json');
  }

  const client = createPgClient();
  await client.connect();

  try {
    const venue = await getVenueBySlugOrThrow(client, 'blend');
    const entity = await getEntityBySlugOrThrow(client, 'blend-fixed-pool');
    const assetIdByContract = await getAssetIdByContractMap(client, 'stellar-mainnet');

    let processed = 0;

    for (const row of eventsFile.scaledRows ?? []) {
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
        on conflict (contract_address, event_id) do nothing
        `,
        [
          venue.id,
          entity.id,
          row.contractAddress,
          row.eventId,
          row.txHash,
          row.ledger,
          row.occurredAt,
          row.eventName,
          row.subEventName,
          row.eventKey,
          row.callerAddress,
          row.tokenIn ? assetIdByContract.get(row.tokenIn) ?? null : null,
          row.tokenOut ? assetIdByContract.get(row.tokenOut) ?? null : null,
          row.tokenAmountIn ?? null,
          row.tokenAmountOut ?? null,
          row.tokenAmountInScaled ?? null,
          row.tokenAmountOutScaled ?? null,
          row.inSuccessfulContractCall,
          JSON.stringify({
            source: '28-blend-events-scaled',
            generatedAt: eventsFile.generatedAt,
          }),
        ]
      );

      processed += 1;
    }

    console.log({
      completedAt: nowIso(),
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