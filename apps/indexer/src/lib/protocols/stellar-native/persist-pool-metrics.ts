import type { Client, PoolClient } from "pg";

import { getVenueBySlugOrThrow } from "../../../scripts/shared/lookup";
import { getLatestAssetPricesMap } from "../../../scripts/shared/prices";
import { parseHorizonAsset } from "./asset-utils";

type DbClient = Pick<Client | PoolClient, "query">;

type SnapshotRow = {
  entity_id: string;
  pool_id: string | null;
  metadata: {
    reserves?: Array<{
      asset: string;
      amount: string;
    }>;
  };
};

export async function persistStellarNativePoolMetrics(
  client: DbClient
) {
  const venue = await getVenueBySlugOrThrow(
    client,
    "stellar-native"
  );

  const priceMap = await getLatestAssetPricesMap(
    client as Client
  );

  const assetsRes = await client.query(
    `
    select
      id,
      contract_address
    from assets
    `
  );

  const assetIdByContract = new Map<
    string,
    string
  >();

  for (const row of assetsRes.rows) {
    assetIdByContract.set(
      row.contract_address,
      row.id
    );
  }

  const snapshots =
    await client.query<SnapshotRow>(
      `
      select
        entity_id,
        pool_id,
        metadata
      from pool_snapshots
      where venue_id = $1
      `,
      [venue.id]
    );

  let processed = 0;

  for (const row of snapshots.rows) {
    const reserves =
      row.metadata?.reserves ?? [];

    let tvlUsd = 0;

    for (const reserve of reserves) {
      const parsed =
        parseHorizonAsset(
          reserve.asset
        );

      const contractAddress =
        parsed.assetType === "native"
          ? "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"
          : parsed.contractAddress;

      const assetId =
        assetIdByContract.get(
          contractAddress
        );

      if (!assetId) {
        continue;
      }

      const priceUsd =
        priceMap.get(assetId) ?? 0;

      const amount = Number(
        reserve.amount
      );

      tvlUsd += amount * priceUsd;
    }

    await client.query(
      `
      insert into pool_metrics_latest (
        venue_id,
        entity_id,
        as_of,
        metric_type,
        tvl_usd,
        metadata
      )
      values (
        $1,
        $2,
        now(),
        'latest',
        $3,
        $4::jsonb
      )
      on conflict (
        entity_id,
        metric_type
      )
      do update set
        as_of = excluded.as_of,
        tvl_usd = excluded.tvl_usd,
        metadata = excluded.metadata
      `,
      [
        venue.id,
        row.entity_id,
        tvlUsd,
        JSON.stringify({
          source:
            "lib/protocols/stellar-native/persist-pool-metrics",
          poolId: row.pool_id,
        }),
      ]
    );

    processed++;
  }

  return {
    processed,
  };
}