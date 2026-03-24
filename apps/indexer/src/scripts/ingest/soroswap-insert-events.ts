import 'dotenv/config';

import { loadJson, nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import {
  getAssetIdByContractMap,
  getEntityBySlugOrThrow,
  getVenueBySlugOrThrow,
} from '../shared/lookup';

type SoroswapNormalizedEventRow = {
  pairId?: string;
  eventId?: string;
  txHash?: string;
  ledger?: number | string | null;
  occurredAt?: string | null;
  eventName?: string | null;
  subEventName?: string | null;
  eventKey?: string | null;
  tokenIn?: string | null;
  tokenOut?: string | null;
  tokenAmountInRaw?: string | null;
  tokenAmountOutRaw?: string | null;
  tokenAmountInScaled?: string | null;
  tokenAmountOutScaled?: string | null;
  reserve0Raw?: string | null;
  reserve1Raw?: string | null;
};

function resolveEntitySlug(params: {
  envEntitySlug: string | undefined;
  eventsFile: any;
  registry: any;
}): string {
  const entitySlug =
    params.envEntitySlug ??
    params.eventsFile?.entitySlug ??
    params.registry?.pair?.entitySlug;

  if (!entitySlug || typeof entitySlug !== 'string') {
    throw new Error(
      'Missing entitySlug. Checked ENTITY_SLUG env, 58-soroswap-active-pair-events-normalized.json, and 59-soroswap-final-registry.json'
    );
  }

  return entitySlug;
}

function resolveExpectedPairId(params: {
  envPairId: string | undefined;
  eventsFile: any;
  registry: any;
}): string | null {
  const pairId =
    params.envPairId ??
    params.eventsFile?.pairId ??
    params.registry?.pair?.pairId ??
    null;

  return typeof pairId === 'string' ? pairId : null;
}

async function main() {
  const eventsFile = await loadJson<any>('58-soroswap-active-pair-events-normalized.json');
  const registry = await loadJson<any>('59-soroswap-final-registry.json');

  if (!eventsFile) {
    throw new Error('Missing 58-soroswap-active-pair-events-normalized.json');
  }

  if (!registry) {
    throw new Error('Missing 59-soroswap-final-registry.json');
  }

  const envEntitySlug = process.env.ENTITY_SLUG;
  const envPairId = process.env.SOROSWAP_PAIR_ID;

  const entitySlug = resolveEntitySlug({
    envEntitySlug,
    eventsFile,
    registry,
  });

  const expectedPairId = resolveExpectedPairId({
    envPairId,
    eventsFile,
    registry,
  });

  const rows: SoroswapNormalizedEventRow[] = Array.isArray(eventsFile.rows)
    ? eventsFile.rows
    : [];

  if (!rows.length) {
    throw new Error('No rows found in 58-soroswap-active-pair-events-normalized.json');
  }

  if (expectedPairId) {
    for (const row of rows) {
      if (row.pairId && row.pairId !== expectedPairId) {
        throw new Error(`Row pairId mismatch: ${row.pairId} !== ${expectedPairId}`);
      }
    }
  }

  const client = createPgClient();
  await client.connect();

  try {
    const venue = await getVenueBySlugOrThrow(client, 'soroswap');
    const entity = await getEntityBySlugOrThrow(client, entitySlug);
    const assetIdByContract = await getAssetIdByContractMap(client, 'stellar-mainnet');

    let processed = 0;

    for (const row of rows) {
      if (!row.eventId || !row.txHash || !row.occurredAt || !row.eventKey) {
        continue;
      }

      const contractAddress = row.pairId ?? expectedPairId;
      if (!contractAddress) {
        throw new Error(`Missing pairId for event ${row.eventId}`);
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
          contractAddress,
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
            source: '58-soroswap-active-pair-events-normalized',
            entitySlug,
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
      expectedPairId,
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