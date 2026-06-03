import type { Client, PoolClient } from "pg";

import {
  buildEntitySlug,
  parseHorizonAsset,
} from "./asset-utils";

import type { HorizonPool } from "./types";

type DbClient = Pick<Client | PoolClient, "query">;

export async function persistHorizonPoolSnapshots(
  client: DbClient,
  pools: HorizonPool[]
) {
  let inserted = 0;

  for (const pool of pools) {
    if (pool.reserves.length !== 2) {
      continue;
    }

    const asset0 = parseHorizonAsset(
      pool.reserves[0].asset
    );

    const asset1 = parseHorizonAsset(
      pool.reserves[1].asset
    );

    const entitySlug = buildEntitySlug(
      asset0.symbol,
      asset1.symbol
    );

    const entityRes = await client.query(
      `
      select id, venue_id
      from entities
      where slug = $1
      limit 1
      `,
      [entitySlug]
    );

    if (!entityRes.rowCount) {
      continue;
    }

    const entity =
      entityRes.rows[0];

    await client.query(
      `
      insert into pool_snapshots (
        venue_id,
        entity_id,
        snapshot_at,
        pool_id,
        pool_name,
        reserve_count,
        metadata
      )
      values (
        $1,$2,$3,$4,$5,$6,$7::jsonb
      )
      on conflict (
        entity_id,
        snapshot_at
      )
      do nothing
      `,
      [
        entity.venue_id,
        entity.id,
        new Date(),
        pool.id,
        `${asset0.symbol}/${asset1.symbol}`,
        pool.reserves.length,
        JSON.stringify({
          feeBp: pool.fee_bp,
          totalShares:
            pool.total_shares,
          totalTrustlines:
            pool.total_trustlines,
          reserves:
            pool.reserves,
          lastModifiedLedger:
            pool.last_modified_ledger,
          lastModifiedTime:
            pool.last_modified_time,
        }),
      ]
    );

    inserted += 1;
  }

  return {
    inserted,
  };
}