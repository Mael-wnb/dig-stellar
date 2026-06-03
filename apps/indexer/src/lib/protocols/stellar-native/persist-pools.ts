import type { Client, PoolClient } from "pg";

import {
  getVenueBySlugOrThrow,
} from "../../../scripts/shared/lookup";

import {
  parseHorizonAsset,
  buildEntitySlug,
} from "./asset-utils";

import type { HorizonPool } from "./types";

type DbClient = Pick<Client | PoolClient, "query">;

export async function persistHorizonPools(
  client: DbClient,
  pools: HorizonPool[]
) {
  const venue = await getVenueBySlugOrThrow(
    client,
    "stellar-native"
  );

  let created = 0;

  for (const pool of pools) {
    if (pool.reserves.length !== 2) {
      continue;
    }

    const reserve0 = pool.reserves[0];
    const reserve1 = pool.reserves[1];

    const asset0 = parseHorizonAsset(
      reserve0.asset
    );

    const asset1 = parseHorizonAsset(
      reserve1.asset
    );

    const entitySlug = buildEntitySlug(
      asset0.symbol,
      asset1.symbol
    );

    const entityName =
      `${asset0.symbol}/${asset1.symbol} Native Pool`;

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
      values (
        $1,$2,$3,$4,$5,$6::jsonb
      )
      on conflict (slug)
      do update set
        updated_at = now()
      returning id
      `,
      [
        venue.id,
        entitySlug,
        entityName,
        "amm_pool",
        pool.id,
        JSON.stringify({
          source: "stellar-native",
        }),
      ]
    );

    const entityId =
      entityRes.rows[0].id;

    const assetRows = [
      {
        role: "token0",
        asset: asset0,
      },
      {
        role: "token1",
        asset: asset1,
      },
    ];

    for (const row of assetRows) {
      const assetRes = await client.query(
        `
        select id
        from assets
        where contract_address = $1
        limit 1
        `,
        [row.asset.contractAddress]
      );

      if (!assetRes.rowCount) {
        continue;
      }

      await client.query(
        `
        insert into entity_assets (
          entity_id,
          asset_id,
          role,
          metadata
        )
        values (
          $1,$2,$3,$4::jsonb
        )
        on conflict (
          entity_id,
          asset_id,
          role
        )
        do nothing
        `,
        [
          entityId,
          assetRes.rows[0].id,
          row.role,
          JSON.stringify({
            source: "stellar-native",
          }),
        ]
      );
    }

    created += 1;
  }

  return {
    processed: created,
  };
}