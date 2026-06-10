import type { Client, PoolClient } from "pg";

import { getVenueBySlugOrThrow } from "../../../scripts/shared/lookup";
import { getLatestAssetPricesMap } from "../../../scripts/shared/prices";
import { horizonAssetToSacContractId } from "./asset-utils";
import { fetchPoolTrades, type PoolTradeMetrics } from "./fetch-pool-trades";

type DbClient = Pick<Client | PoolClient, "query">;

// Native XLM Stellar Asset Contract — used to look up the XLM USD price.
const XLM_SAC_CONTRACT =
  "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";

type SnapshotRow = {
  entity_id: string;
  pool_id: string | null;
  // True when this entity's latest snapshot belongs to the most recent
  // ingestion batch (i.e. it was actually ingested by the last refresh).
  // Legacy entities (no fresh snapshot) are false → we skip their trade fetch.
  is_active: boolean;
  metadata: {
    feeBp?: number;
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

  // XLM USD price (for valuing the native leg of trades). null if unknown.
  const xlmAssetId = assetIdByContract.get(XLM_SAC_CONTRACT);
  const xlmUsd =
    xlmAssetId !== undefined ? priceMap.get(xlmAssetId) ?? null : null;

  // Only the LATEST snapshot per entity: avoids fetching trades multiple times
  // for the same pool (one row per historical snapshot) and the resulting
  // last-write-wins races on pool_metrics_latest. `is_active` flags entities
  // whose latest snapshot is part of the current ingestion batch (anchored to
  // the venue's max snapshot_at), so we only fetch trades for freshly-ingested
  // pools and skip the legacy cruft left by pre-allowlist runs.
  const snapshots =
    await client.query<SnapshotRow>(
      `
      select distinct on (ps.entity_id)
        ps.entity_id,
        ps.pool_id,
        ps.metadata,
        (
          ps.snapshot_at >= (
            select max(snapshot_at) from pool_snapshots where venue_id = $1
          ) - interval '10 minutes'
        ) as is_active
      from pool_snapshots ps
      where ps.venue_id = $1
      order by ps.entity_id, ps.snapshot_at desc
      `,
      [venue.id]
    );

  // Fetch trade metrics for the active pools CONCURRENTLY (each call paginates
  // internally with its own 429 retry). Doing this sequentially per pool was the
  // refresh bottleneck; in parallel the wall time collapses to the slowest pool.
  const tradeMetricsByEntity = new Map<string, PoolTradeMetrics>();

  await Promise.all(
    snapshots.rows
      .filter((row) => row.pool_id && row.is_active)
      .map(async (row) => {
        const metrics = await fetchPoolTrades({
          poolId: row.pool_id as string,
          feeBp: row.metadata?.feeBp ?? 0,
          xlmUsd,
        });
        tradeMetricsByEntity.set(row.entity_id, metrics);
      })
  );

  let processed = 0;

  for (const row of snapshots.rows) {
    const reserves =
      row.metadata?.reserves ?? [];

    let tvlUsd = 0;

    for (const reserve of reserves) {
      // Resolve the reserve to its SAC contract (the key the assets table uses)
      // so both the native AND the issued (USDC/EURC/…) legs get priced.
      const contractAddress = horizonAssetToSacContractId(reserve.asset);

      if (!contractAddress) {
        continue;
      }

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

    // 24h volume / fees / trade count, from the concurrent trade fetch above.
    // Only active pools were fetched (legacy entities are skipped to keep the
    // refresh fast). Pools with no trades in 24h legitimately yield 0.
    let volume24hUsd = 0;
    let fees24hUsd = 0;
    let trades24h = 0;

    const tradeMetrics = tradeMetricsByEntity.get(row.entity_id);
    if (tradeMetrics) {
      volume24hUsd = tradeMetrics.volume24hUsd;
      fees24hUsd = tradeMetrics.fees24hUsd;
      trades24h = tradeMetrics.trades24h;
    }

    await client.query(
      `
      insert into pool_metrics_latest (
        venue_id,
        entity_id,
        as_of,
        metric_type,
        tvl_usd,
        volume_24h_usd,
        fees_24h_usd,
        metadata
      )
      values (
        $1,
        $2,
        now(),
        'latest',
        $3,
        $4,
        $5,
        $6::jsonb
      )
      on conflict (
        entity_id,
        metric_type
      )
      do update set
        as_of = excluded.as_of,
        tvl_usd = excluded.tvl_usd,
        volume_24h_usd = excluded.volume_24h_usd,
        fees_24h_usd = excluded.fees_24h_usd,
        metadata = excluded.metadata
      `,
      [
        venue.id,
        row.entity_id,
        tvlUsd,
        volume24hUsd,
        fees24hUsd,
        JSON.stringify({
          source:
            "lib/protocols/stellar-native/persist-pool-metrics",
          poolId: row.pool_id,
          trades24h,
        }),
      ]
    );

    processed++;
  }

  return {
    processed,
  };
}