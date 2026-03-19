import { loadJson, nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { getAssetIdByContractMap, getEntityBySlugOrThrow, getVenueBySlugOrThrow } from '../shared/lookup';

async function main() {
  const poolSnapshot = await loadJson<any>('42-blend-pool-snapshot-db-ready.json');
  const reserveSnapshots = await loadJson<any>('43-blend-reserve-snapshots-db-ready.json');

  if (!poolSnapshot || !reserveSnapshots) {
    throw new Error('Missing snapshot JSON files');
  }

  const client = createPgClient();
  await client.connect();

  try {
    await client.query('begin');

    const venue = await getVenueBySlugOrThrow(client, 'blend');
    const entity = await getEntityBySlugOrThrow(client, 'blend-fixed-pool');
    const assetIdByContract = await getAssetIdByContractMap(client, 'stellar-mainnet');

    const snapshotAt = poolSnapshot.generatedAt ?? nowIso();

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
      do update set
        pool_id = excluded.pool_id,
        pool_name = excluded.pool_name,
        reserve_count = excluded.reserve_count,
        total_events = excluded.total_events,
        total_deposits = excluded.total_deposits,
        total_swaps = excluded.total_swaps,
        total_exit_pool = excluded.total_exit_pool,
        unique_callers = excluded.unique_callers,
        metadata = excluded.metadata
      `,
      [
        venue.id,
        entity.id,
        snapshotAt,
        poolSnapshot.poolId,
        poolSnapshot.poolName,
        poolSnapshot.reserveCount,
        poolSnapshot.totalEvents,
        poolSnapshot.totalDeposits,
        poolSnapshot.totalSwaps,
        poolSnapshot.totalExitPool,
        poolSnapshot.uniqueCallers,
        JSON.stringify({
          source: '42-blend-pool-snapshot-db-ready',
        }),
      ]
    );

    for (const row of reserveSnapshots.reserveRows ?? []) {
      const assetId = assetIdByContract.get(row.assetId);
      if (!assetId) continue;

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
          row.generatedAt ?? snapshotAt,
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
            source: '43-blend-reserve-snapshots-db-ready',
          }),
        ]
      );
    }

    await client.query('commit');

    console.log({
      completedAt: nowIso(),
      reserveCount: reserveSnapshots.reserveRows?.length ?? 0,
    });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});