// apps/indexer/src/lib/protocols/soroswap/persist-pair-reserves.ts
// Hotfix (frozen-TVL bug, docs/hotfix-frozen-amm-reserves.md): the pair-metrics
// step READS reserve_snapshots but nothing on the live refresh path wrote them
// since the one-shot March-2026 legacy inserts. This persists the just-fetched
// live reserves every cycle, mirroring the Blend snapshot conventions
// (AMM reserve amount lands in d_supply_raw / d_supply_scaled — the columns
// persist-pair-metrics reads).

import type { Client, PoolClient } from 'pg';
import { nowIso } from '../../../scripts/discovery/00-common';
import {
  getEntityBySlugOrThrow,
  getVenueBySlugOrThrow,
} from '../../../scripts/shared/lookup';
import type { SoroswapPairState } from './types';

type DbClient = Pick<Client | PoolClient, 'query'>;

async function upsertAsset(params: {
  client: DbClient;
  contractAddress: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
}) {
  await params.client.query(
    `
    insert into assets (
      chain,
      contract_address,
      asset_type,
      symbol,
      name,
      decimals,
      metadata
    )
    values ($1,$2,$3,$4,$5,$6,$7::jsonb)
    on conflict (contract_address)
    do update set
      symbol = excluded.symbol,
      name = excluded.name,
      decimals = excluded.decimals,
      updated_at = now()
    `,
    [
      'stellar-mainnet',
      params.contractAddress,
      'soroban_token',
      params.symbol,
      params.name,
      params.decimals,
      JSON.stringify({
        source: 'lib/protocols/soroswap/persist-pair-reserves',
      }),
    ]
  );
}

export async function persistSoroswapPairReserves(params: {
  client: DbClient;
  pairState: SoroswapPairState;
}): Promise<{
  snapshotAt: string;
  entitySlug: string;
  pairId: string;
  reserveCount: number;
}> {
  const { client, pairState } = params;

  const venue = await getVenueBySlugOrThrow(client, 'soroswap');
  const entity = await getEntityBySlugOrThrow(client, pairState.entitySlug);

  if (entity.contract_address && entity.contract_address !== pairState.pairId) {
    throw new Error(
      `Entity contract_address mismatch for ${pairState.entitySlug}: ${entity.contract_address} !== ${pairState.pairId}`
    );
  }

  for (const row of pairState.reserveRows) {
    await upsertAsset({
      client,
      contractAddress: row.contractId,
      symbol: row.symbol,
      name: row.name,
      decimals: row.decimals,
    });
  }

  const assetRes = await client.query(
    `
    select id, contract_address
    from assets
    where contract_address = any($1::text[])
    `,
    [pairState.reserveRows.map((row) => row.contractId)]
  );

  const assetIdByContract = new Map<string, string>(
    assetRes.rows.map((row: { id: string; contract_address: string }) => [
      row.contract_address,
      row.id,
    ])
  );

  const snapshotAt = nowIso();

  for (const row of pairState.reserveRows) {
    const assetId = assetIdByContract.get(row.contractId);
    if (!assetId) {
      throw new Error(`Missing asset after upsert: ${row.contractId}`);
    }

    await client.query(
      `
      insert into reserve_snapshots (
        venue_id,
        entity_id,
        asset_id,
        snapshot_at,
        symbol,
        name,
        decimals,
        enabled,
        d_supply_raw,
        d_supply_scaled,
        metadata
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      on conflict (entity_id, asset_id, snapshot_at)
      do update set
        symbol = excluded.symbol,
        name = excluded.name,
        decimals = excluded.decimals,
        enabled = excluded.enabled,
        d_supply_raw = excluded.d_supply_raw,
        d_supply_scaled = excluded.d_supply_scaled,
        metadata = excluded.metadata
      `,
      [
        venue.id,
        entity.id,
        assetId,
        snapshotAt,
        row.symbol,
        row.name,
        row.decimals,
        true,
        row.reserveRaw,
        row.reserveScaled,
        JSON.stringify({
          source: 'lib/protocols/soroswap/persist-pair-reserves',
          pairId: pairState.pairId,
        }),
      ]
    );
  }

  return {
    snapshotAt,
    entitySlug: entity.slug,
    pairId: pairState.pairId,
    reserveCount: pairState.reserveRows.length,
  };
}
