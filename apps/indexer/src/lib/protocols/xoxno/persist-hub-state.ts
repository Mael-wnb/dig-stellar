// apps/indexer/src/lib/protocols/xoxno/persist-hub-state.ts
//
// Persist one XOXNO hub refresh (Blend pattern, see blend/persist-pool-state.ts):
// venue + entity upsert, assets + entity_assets (role 'reserve'), one
// pool_snapshots row and one reserve_snapshots row PER MARKET, all under a
// single snapshot_at inside one transaction (all-or-nothing batch — readers
// take "the latest snapshot_at for this entity" as the complete market set).
//
// Column mapping follows the Blend convention already baked into the API and
// the metrics readers: b_supply_* = SUPPLIED, d_supply_* = BORROWED. Cash (the
// TVL leg) has no column and lives in reserve_snapshots.metadata.cash*.
// APRs go in supply_apr / borrow_apr, exp(apr)-1 in est_*_apy. Utilisation and
// the interest-rate model also live in metadata.
//
// Scoped pricing fallback (founder decisions, Lot XO gates 1a/1b): the XOXNO
// price aggregator (controller.get_market_indexes_detailed) may price an asset
// ONLY when that asset is structurally uncovered by our own pricing — i.e. it has
// no rule in shared/pricing-config.ts, or carries the explicit
// `{ kind: 'external', source: 'xoxno-aggregator' }` marker (XAUM, USST, deJTRSY,
// deJAAA, the Aquarius LP tokens); the predicate lives in pricing-scope.ts and is
// the same one the fetch uses to decide which keys are read at all. An asset
// WITH an own rule never falls back, even when its own price is stale: it keeps
// the product-wide staleness semantics (fresh ≤ PRICE_MAX_AGE_MINUTES, else
// unpriced), exactly like Blend.
// The row (source 'xoxno-aggregator') is also skipped when the aggregator flags
// the price stale / !valid, or when its own timestamp is older than
// XOXNO_AGGREGATOR_MAX_AGE_SEC, or when a fresh own-source row already exists.
// compute-pool-metrics additionally orders this source last.
import type { Client, PoolClient } from 'pg';
import { nowIso } from '../../../scripts/discovery/00-common';
import { freshPriceSql } from '../../../scripts/shared/prices';
import { isAggregatorFallbackEligible, pricingRuleForSymbol } from './pricing-scope';
import {
  XOXNO_AGGREGATOR_MAX_AGE_SEC,
  XOXNO_AGGREGATOR_PRICE_SOURCE,
  XOXNO_PRICE_AGGREGATOR_CONTRACT,
  XOXNO_VENUE_NAME,
  XOXNO_VENUE_SLUG,
  type XoxnoHubEntityMetadata,
  type XoxnoHubState,
} from './types';

type DbClient = Pick<Client | PoolClient, 'query'>;

const SOURCE = 'lib/protocols/xoxno/persist-hub-state';

export type XoxnoFallbackPriceWrite = {
  asset: string;
  symbol: string;
  priceUsd: number;
  priceTimestamp: number;
  ageSec: number;
};

export async function persistXoxnoHubState(params: {
  client: DbClient;
  hubState: XoxnoHubState;
  /** The entity's seed metadata (hub id, market list, provenance) — preserved on refresh. */
  seedMetadata: XoxnoHubEntityMetadata;
  debug?: boolean;
}): Promise<{
  snapshotAt: string;
  entitySlug: string;
  reserveCount: number;
  fallbackPrices: XoxnoFallbackPriceWrite[];
  fallbackSkipped: Array<{ symbol: string; reason: string }>;
}> {
  const { client, hubState, seedMetadata, debug = false } = params;
  const snapshotAt = nowIso();
  const fallbackPrices: XoxnoFallbackPriceWrite[] = [];
  const fallbackSkipped: Array<{ symbol: string; reason: string }> = [];

  await client.query('BEGIN');
  try {
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
      returning id
      `,
      [XOXNO_VENUE_SLUG, XOXNO_VENUE_NAME, 'stellar-mainnet', 'lending', JSON.stringify({ source: SOURCE })]
    );
    const venueId = venueRes.rows[0].id as string;

    const entityMetadata: XoxnoHubEntityMetadata = {
      ...seedMetadata,
      hubId: hubState.hubId,
      hubName: hubState.hubName,
      pool: hubState.poolContract,
      controller: hubState.controllerContract,
      appVersion: hubState.appVersion,
      latestLedger: hubState.latestLedger,
      reserveCount: hubState.markets.length,
      lastRefreshAt: snapshotAt,
      // Static params cache (24 h): carried over or refreshed by the fetch.
      paramsCache: hubState.paramsCache,
    };

    const entityRes = await client.query(
      `
      insert into entities (venue_id, slug, name, entity_type, contract_address, metadata)
      values ($1,$2,$3,$4,$5,$6::jsonb)
      on conflict (slug)
      do update set
        entity_type = excluded.entity_type,
        contract_address = excluded.contract_address,
        metadata = excluded.metadata,
        updated_at = now()
      returning id
      `,
      [venueId, hubState.entitySlug, `${hubState.hubName} hub`, hubState.entityType, hubState.poolContract, JSON.stringify(entityMetadata)]
    );
    const entityId = entityRes.rows[0].id as string;

    // Assets: insert when missing; an EXISTING row keeps its symbol/name (the
    // product keys pricing rules by symbol — e.g. XLM is 'native' here, never
    // overwrite it with XOXNO's label). Decimals are filled only when null.
    for (const m of hubState.markets) {
      await client.query(
        `
        insert into assets (chain, contract_address, asset_type, symbol, name, decimals, metadata)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb)
        on conflict (contract_address)
        do update set
          decimals = coalesce(assets.decimals, excluded.decimals),
          updated_at = now()
        `,
        ['stellar-mainnet', m.asset, 'soroban_token', m.symbol, m.name, m.decimals, JSON.stringify({ source: SOURCE })]
      );
    }

    const assetRes = await client.query(
      `select id, contract_address, symbol, name, decimals from assets where contract_address = any($1::text[])`,
      [hubState.markets.map((m) => m.asset)]
    );
    const assetByContract = new Map<string, { id: string; symbol: string | null; name: string | null; decimals: number | null }>(
      (assetRes.rows as Array<{ id: string; contract_address: string; symbol: string | null; name: string | null; decimals: number | null }>).map((r) => [
        r.contract_address,
        { id: r.id, symbol: r.symbol, name: r.name, decimals: r.decimals },
      ])
    );

    for (const m of hubState.markets) {
      const asset = assetByContract.get(m.asset);
      if (!asset) throw new Error(`Missing asset after upsert: ${m.asset}`);
      if (asset.decimals !== null && asset.decimals !== m.decimals) {
        // Our assets row disagrees with MarketParamsRaw.asset_decimals: refuse to
        // write amounts that one of the two would misread.
        throw new Error(`${m.symbol}: assets.decimals=${asset.decimals} but on-chain asset_decimals=${m.decimals}`);
      }
      await client.query(
        `
        insert into entity_assets (entity_id, asset_id, role, metadata)
        values ($1,$2,$3,$4::jsonb)
        on conflict (entity_id, asset_id, role) do update set metadata = excluded.metadata
        `,
        [entityId, asset.id, 'reserve', JSON.stringify({ source: SOURCE, hubId: hubState.hubId })]
      );
    }

    await client.query(
      `
      insert into pool_snapshots (
        venue_id, entity_id, snapshot_at, pool_id, pool_name, reserve_count,
        total_events, total_deposits, total_swaps, total_exit_pool, unique_callers, metadata
      )
      values ($1,$2,$3,$4,$5,$6,null,null,null,null,null,$7::jsonb)
      on conflict (entity_id, snapshot_at) do nothing
      `,
      [
        venueId,
        entityId,
        snapshotAt,
        hubState.poolContract,
        `${hubState.hubName} hub`,
        hubState.markets.length,
        JSON.stringify({
          source: SOURCE,
          hubId: hubState.hubId,
          appVersion: hubState.appVersion,
          latestLedger: hubState.latestLedger,
          readStats: hubState.readStats,
          callPlan: hubState.callPlan,
          paramsFetchedAt: hubState.paramsCache.fetchedAt,
        }),
      ]
    );

    for (const m of hubState.markets) {
      const asset = assetByContract.get(m.asset)!;
      await client.query(
        `
        insert into reserve_snapshots (
          venue_id, entity_id, asset_id, snapshot_at, symbol, name, decimals, enabled,
          d_supply_raw, b_supply_raw, backstop_credit_raw,
          d_supply_scaled, b_supply_scaled, backstop_credit_scaled,
          supply_cap_raw, supply_cap_scaled,
          borrow_apr, est_borrow_apy, supply_apr, est_supply_apy, metadata
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null,$11,$12,null,null,null,$13,$14,$15,$16,$17::jsonb)
        on conflict (entity_id, asset_id, snapshot_at)
        do update set
          symbol = excluded.symbol, name = excluded.name, decimals = excluded.decimals, enabled = excluded.enabled,
          d_supply_raw = excluded.d_supply_raw, b_supply_raw = excluded.b_supply_raw,
          d_supply_scaled = excluded.d_supply_scaled, b_supply_scaled = excluded.b_supply_scaled,
          borrow_apr = excluded.borrow_apr, est_borrow_apy = excluded.est_borrow_apy,
          supply_apr = excluded.supply_apr, est_supply_apy = excluded.est_supply_apy,
          metadata = excluded.metadata
        `,
        [
          venueId,
          entityId,
          asset.id,
          snapshotAt,
          asset.symbol ?? m.symbol,
          asset.name ?? m.name,
          m.decimals,
          true,
          // Blend convention kept product-wide: d_* = borrowed, b_* = supplied.
          m.borrowedRaw.toString(),
          m.suppliedRaw.toString(),
          m.borrowed.toString(),
          m.supplied.toString(),
          m.borrowApr,
          m.estBorrowApy,
          m.depositApr,
          m.estSupplyApy,
          JSON.stringify({
            source: SOURCE,
            hubId: hubState.hubId,
            asset: m.asset,
            marketSymbol: m.symbol,
            cashRaw: m.cashRaw.toString(),
            cash: m.cash,
            utilisation: m.utilisation,
            interestRateModel: m.interestRateModel,
            aggregatorPrice: m.aggregatorPrice,
            note: 'cash = pool.get_reserves (TVL leg); supplied/borrowed = pool views accrued to now; APR in *_apr, exp(apr)-1 in est_*_apy',
          }),
        ]
      );
    }

    // Scoped pricing fallback — structurally uncovered assets only (see header).
    for (const m of hubState.markets) {
      const asset = assetByContract.get(m.asset)!;
      const ruleSymbol = asset.symbol ?? m.symbol;
      const rule = pricingRuleForSymbol(ruleSymbol);
      if (!isAggregatorFallbackEligible(ruleSymbol)) {
        fallbackSkipped.push({ symbol: m.symbol, reason: `own pricing rule (${rule?.kind ?? 'none'}) — never read from the aggregator` });
        continue;
      }
      const price = m.aggregatorPrice;
      if (!price) {
        fallbackSkipped.push({ symbol: m.symbol, reason: 'no aggregator read (chunk failed or market not in the fetch scope)' });
        continue;
      }
      if (!price.valid || price.stale || price.errorCode !== null || !(price.priceUsd > 0)) {
        fallbackSkipped.push({
          symbol: m.symbol,
          reason: `aggregator valid=${price.valid} stale=${price.stale} error=${price.errorCode ?? 'none'} price=${price.priceUsd}`,
        });
        continue;
      }
      if (price.ageSec > XOXNO_AGGREGATOR_MAX_AGE_SEC) {
        fallbackSkipped.push({ symbol: m.symbol, reason: `aggregator timestamp ${price.ageSec}s old > ${XOXNO_AGGREGATOR_MAX_AGE_SEC}s max` });
        continue;
      }
      const existing = await client.query(
        `
        select ap.source from asset_prices ap
        where ap.asset_id = $1 and ap.source <> $2 and ${freshPriceSql('ap')}
        order by ap.observed_at desc limit 1
        `,
        [asset.id, XOXNO_AGGREGATOR_PRICE_SOURCE]
      );
      if (existing.rowCount) {
        fallbackSkipped.push({ symbol: m.symbol, reason: `fresh ${existing.rows[0].source} price exists` });
        continue;
      }
      await client.query(
        `
        insert into asset_prices (asset_id, price_usd, source, observed_at, metadata)
        values ($1,$2,$3,$4,$5::jsonb)
        on conflict (asset_id, source, observed_at) do nothing
        `,
        [
          asset.id,
          price.priceUsd,
          XOXNO_AGGREGATOR_PRICE_SOURCE,
          snapshotAt,
          JSON.stringify({
            method: 'xoxno_price_aggregator_fallback',
            contract: XOXNO_PRICE_AGGREGATOR_CONTRACT,
            via: 'controller.get_market_indexes_detailed',
            hubId: hubState.hubId,
            priceTimestamp: price.priceTimestamp,
            ageSec: price.ageSec,
            primaryPriceUsd: price.primaryPriceUsd,
            anchorPriceUsd: price.anchorPriceUsd,
            deviation: price.deviation,
            maxAgeSec: XOXNO_AGGREGATOR_MAX_AGE_SEC,
            pricingRule: rule ? rule.kind : 'none',
            confidence: 'medium',
            note: 'Scoped exception to the 2026-08-17 "our data only" rule: written only when no fresh own-source price exists (docs/decisions/2026-10-27-xoxno-tvl-and-pricing.md)',
          }),
        ]
      );
      fallbackPrices.push({ asset: m.asset, symbol: m.symbol, priceUsd: price.priceUsd, priceTimestamp: price.priceTimestamp, ageSec: price.ageSec });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  if (debug) {
    console.log({ snapshotAt, entitySlug: hubState.entitySlug, reserveCount: hubState.markets.length, fallbackPrices, fallbackSkipped });
  }

  return { snapshotAt, entitySlug: hubState.entitySlug, reserveCount: hubState.markets.length, fallbackPrices, fallbackSkipped };
}
