// apps/indexer/src/lib/protocols/blend/persist-pool-state.ts

import type { Client, PoolClient } from 'pg';
import { nowIso } from '../../../scripts/discovery/00-common';
import { BlendPoolState } from './types';

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
        source: 'lib/protocols/blend/persist-pool-state',
      }),
    ]
  );
}

export async function persistBlendPoolState(params: {
  client: DbClient;
  poolState: BlendPoolState;
  debug?: boolean;
}) {
  const { client, poolState, debug = false } = params;

  const venueRes = await client.query(
    `
    insert into venues (slug, name, chain, venue_type, metadata)
    values ($1,$2,$3,$4,$5::jsonb)
    on conflict (slug)
    do update set
      name = excluded.name,
      chain = excluded.chain,
      venue_type = excluded.venue_type,
      updated_at = now()
    returning id, slug, name
    `,
    [
      'blend',
      'Blend',
      'stellar-mainnet',
      'lending',
      JSON.stringify({
        source: 'lib/protocols/blend/persist-pool-state',
      }),
    ]
  );

  const venue = venueRes.rows[0] as { id: string; slug: string; name: string };

  const entityRes = await client.query(
    `
    insert into entities (
      venue_id,
      slug,
      name,
      entity_type,
      contract_address,
      metadata
    )
    values ($1,$2,$3,$4,$5,$6::jsonb)
    on conflict (slug)
    do update set
      name = excluded.name,
      entity_type = excluded.entity_type,
      contract_address = excluded.contract_address,
      metadata = excluded.metadata,
      updated_at = now()
    returning id, slug, name
    `,
    [
      venue.id,
      poolState.entitySlug,
      poolState.poolName ?? poolState.entitySlug,
      'lending_pool',
      poolState.poolId,
      JSON.stringify({
        source: 'lib/protocols/blend/persist-pool-state',
        reserveCount: poolState.reserveCount,
        admin: poolState.metadata.admin,
        backstop: poolState.metadata.backstop,
        oracle: poolState.metadata.oracle,
        status: poolState.metadata.status,
        maxPositions: poolState.metadata.maxPositions,
        minCollateral: poolState.metadata.minCollateral,
      }),
    ]
  );

  const entity = entityRes.rows[0] as { id: string; slug: string; name: string };

  for (const asset of poolState.assets) {
    await upsertAsset({
      client,
      contractAddress: asset.contractId,
      symbol: asset.symbol,
      name: asset.name,
      decimals: asset.decimals,
    });
  }

  const assetRes = await client.query(
    `
    select id, contract_address
    from assets
    where contract_address = any($1::text[])
    `,
    [poolState.assets.map((asset) => asset.contractId)]
  );

  const assetIdByContract = new Map<string, string>(
    assetRes.rows.map((row: { id: string; contract_address: string }) => [
      row.contract_address,
      row.id,
    ])
  );

  for (const asset of poolState.assets) {
    const assetId = assetIdByContract.get(asset.contractId);
    if (!assetId) {
      throw new Error(`Missing asset after upsert: ${asset.contractId}`);
    }

    await client.query(
      `
      insert into entity_assets (entity_id, asset_id, role, metadata)
      values ($1,$2,$3,$4::jsonb)
      on conflict (entity_id, asset_id, role)
      do update set
        metadata = excluded.metadata
      `,
      [
        entity.id,
        assetId,
        'reserve',
        JSON.stringify({
          source: 'lib/protocols/blend/persist-pool-state',
        }),
      ]
    );
  }

  const snapshotAt = nowIso();

  await client.query(
    `
    insert into pool_snapshots (
      venue_id,
      entity_id,
      snapshot_at,
      pool_id,
      pool_name,
      reserve_count,
      total_events,
      total_deposits,
      total_swaps,
      total_exit_pool,
      unique_callers,
      metadata
    )
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
    on conflict (entity_id, snapshot_at)
    do nothing
    `,
    [
      venue.id,
      entity.id,
      snapshotAt,
      poolState.poolId,
      poolState.poolName,
      poolState.reserveCount,
      null,
      null,
      null,
      null,
      null,
      JSON.stringify({
        source: 'lib/protocols/blend/persist-pool-state',
      }),
    ]
  );

  for (const row of poolState.reserveRows) {
    const assetId = assetIdByContract.get(row.assetId);
    if (!assetId) {
      throw new Error(`Missing asset_id for reserve row: ${row.assetId}`);
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
        b_supply_raw,
        backstop_credit_raw,
        d_supply_scaled,
        b_supply_scaled,
        backstop_credit_scaled,
        supply_cap_raw,
        supply_cap_scaled,
        borrow_apr,
        est_borrow_apy,
        supply_apr,
        est_supply_apy,
        metadata
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb
      )
      on conflict (entity_id, asset_id, snapshot_at)
      do update set
        symbol = excluded.symbol,
        name = excluded.name,
        decimals = excluded.decimals,
        enabled = excluded.enabled,
        d_supply_raw = excluded.d_supply_raw,
        b_supply_raw = excluded.b_supply_raw,
        backstop_credit_raw = excluded.backstop_credit_raw,
        d_supply_scaled = excluded.d_supply_scaled,
        b_supply_scaled = excluded.b_supply_scaled,
        backstop_credit_scaled = excluded.backstop_credit_scaled,
        supply_cap_raw = excluded.supply_cap_raw,
        supply_cap_scaled = excluded.supply_cap_scaled,
        borrow_apr = excluded.borrow_apr,
        est_borrow_apy = excluded.est_borrow_apy,
        supply_apr = excluded.supply_apr,
        est_supply_apy = excluded.est_supply_apy,
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
        row.enabled,
        row.dSupplyRaw,
        row.bSupplyRaw,
        row.backstopCreditRaw,
        row.dSupplyScaled,
        row.bSupplyScaled,
        row.backstopCreditScaled,
        row.supplyCapRaw,
        row.supplyCapScaled,
        row.borrowApr,
        row.estBorrowApy,
        row.supplyApr,
        row.estSupplyApy,
        JSON.stringify({
          source: 'lib/protocols/blend/persist-pool-state',
        }),
      ]
    );
  }

  if (debug) {
    console.log({
      snapshotAt,
      entitySlug: poolState.entitySlug,
      reserveCount: poolState.reserveRows.length,
    });
  }

  return {
    snapshotAt,
    entitySlug: poolState.entitySlug,
    poolId: poolState.poolId,
    reserveCount: poolState.reserveRows.length,
  };
}