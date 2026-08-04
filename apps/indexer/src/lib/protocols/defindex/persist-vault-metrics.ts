// apps/indexer/src/lib/protocols/defindex/persist-vault-metrics.ts
import type { Client, PoolClient } from 'pg';
import { nowIso } from '../../../scripts/discovery/00-common';
import {
  getEntityBySlugOrThrow,
  getVenueBySlugOrThrow,
} from '../../../scripts/shared/lookup';
import type { DefindexVaultFetch, DefindexVaultMetrics } from './types';

type DbClient = Pick<Client | PoolClient, 'query'>;

type AssetPriceRow = {
  contract_address: string;
  decimals: number | null;
  price_usd: string | null;
};

// Persist one DeFindex vault's latest metrics into the v1 pipeline:
//   - TVL(USD): Σ over underlying holdings of (rawAmount / 10^decimals) * priceUsd,
//     pricing each underlying via the assets + asset_prices tables (populated by
//     step 62), exactly like the Aquarius adapter prices its reserves.
//   - APY: the vault's 7-day APY, stored as a FRACTION in weighted_supply_apy
//     (the web renders it with formatPercentFromRatio, i.e. ×100). 7.14% -> 0.0714.
// Writes pool_metrics_latest (metric_type='latest') + a pool_snapshots history row.
export async function persistDefindexVaultMetrics(params: {
  client: DbClient;
  entitySlug: string;
  expectedVaultAddress: string;
  fetched: DefindexVaultFetch;
}): Promise<DefindexVaultMetrics> {
  const { client, entitySlug, expectedVaultAddress, fetched } = params;

  const venue = await getVenueBySlugOrThrow(client, 'defindex');
  const entity = await getEntityBySlugOrThrow(client, entitySlug);

  if (entity.contract_address !== expectedVaultAddress) {
    throw new Error(
      `Entity contract_address mismatch for ${entitySlug}: ${entity.contract_address} !== ${expectedVaultAddress}`
    );
  }

  const contracts = fetched.holdings.map((h) => h.assetContract);

  // Resolve decimals + latest USD price for each underlying asset in one query.
  const priceRows = contracts.length
    ? ((
        await client.query(
          `
          select
            a.contract_address,
            a.decimals,
            (
              select ap.price_usd
              from asset_prices ap
              where ap.asset_id = a.id
              order by ap.observed_at desc
              limit 1
            ) as price_usd
          from assets a
          where a.contract_address = any($1::text[])
          `,
          [contracts]
        )
      ).rows as AssetPriceRow[])
    : [];

  const byContract = new Map<string, AssetPriceRow>(
    priceRows.map((row) => [row.contract_address, row])
  );

  let tvlUsd = 0;
  let pricedHoldings = 0;
  let unpricedHoldings = 0;

  for (const holding of fetched.holdings) {
    const meta = byContract.get(holding.assetContract);
    const price = meta?.price_usd != null ? Number(meta.price_usd) : null;
    const decimals = meta?.decimals != null ? Number(meta.decimals) : 7;

    if (price === null || !Number.isFinite(price)) {
      unpricedHoldings += 1;
      console.warn(
        `[defindex] no price for underlying ${holding.assetContract} (vault ${entitySlug}); skipping leg`
      );
      continue;
    }

    const humanAmount = Number(holding.rawAmount) / 10 ** decimals;
    tvlUsd += humanAmount * price;
    pricedHoldings += 1;
  }

  const supplyApy =
    fetched.apyPct !== null && Number.isFinite(fetched.apyPct)
      ? fetched.apyPct / 100
      : null;

  const asOf = nowIso();

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
      total_supplied_usd,
      total_borrowed_usd,
      net_liquidity_usd,
      total_backstop_credit_usd,
      weighted_supply_apy,
      weighted_borrow_apy,
      metadata
    )
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
    on conflict (entity_id, metric_type)
    do update set
      as_of = excluded.as_of,
      tvl_usd = excluded.tvl_usd,
      total_supplied_usd = excluded.total_supplied_usd,
      weighted_supply_apy = excluded.weighted_supply_apy,
      metadata = excluded.metadata,
      updated_at = now()
    `,
    [
      venue.id,
      entity.id,
      asOf,
      'latest',
      tvlUsd,
      0,
      0,
      tvlUsd, // total_supplied_usd: for a single-sided yield vault, TVL == supplied
      null,
      null,
      null,
      supplyApy,
      null,
      JSON.stringify({
        source: 'lib/protocols/defindex/persist-vault-metrics',
        entitySlug,
        vaultAddress: expectedVaultAddress,
        vaultName: fetched.name,
        vaultSymbol: fetched.symbol,
        apyPct: fetched.apyPct,
        pricedHoldings,
        unpricedHoldings,
      }),
    ]
  );

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
    values ($1,$2,$3,$4,$5,$6,$7::jsonb)
    on conflict (entity_id, snapshot_at)
    do update set
      pool_id = excluded.pool_id,
      pool_name = excluded.pool_name,
      reserve_count = excluded.reserve_count,
      metadata = excluded.metadata
    `,
    [
      venue.id,
      entity.id,
      asOf,
      expectedVaultAddress,
      fetched.name,
      fetched.holdings.length,
      JSON.stringify({
        source: 'lib/protocols/defindex/persist-vault-metrics',
        tvlUsd,
        apyPct: fetched.apyPct,
        holdings: fetched.holdings,
      }),
    ]
  );

  return {
    completedAt: asOf,
    entitySlug,
    tvlUsd,
    supplyApy,
    pricedHoldings,
    unpricedHoldings,
  };
}
