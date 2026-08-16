// apps/api/src/modules/stellar/stellar.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Asset, Networks } from '@stellar/stellar-sdk';
import { PrismaService } from '../../db/prisma.service';
import { computeFreshness } from '../../common/freshness';

// Resolve a Horizon reserve asset ("native" or "CODE:ISSUER") to its Stellar
// Asset Contract (SAC) id. stellar-native pools store reserves in Horizon
// format inside pool_snapshots.metadata; the `assets` table is keyed by the SAC
// contract (C…), so we convert here to price each leg. Mirrors the indexer's
// asset-utils.horizonAssetToSacContractId. Returns null if unparseable.
function horizonAssetToSacContractId(asset: string): string | null {
  try {
    if (asset === 'native') return Asset.native().contractId(Networks.PUBLIC);
    const [code, issuer] = asset.split(':');
    if (!code || !issuer) return null;
    return new Asset(code, issuer).contractId(Networks.PUBLIC);
  } catch {
    return null;
  }
}

// Freshness fields (T3-D1) to spread into every payload that carries an `as_of`.
// staleness is computed at read time from the shared helper
// (FRESHNESS_STALE_AFTER_MINUTES, default 45). `stale` is kept as a
// backward-compatible alias of `isStale`.
function freshnessFields(asOf: unknown): {
  stale: boolean | null;
  isStale: boolean | null;
  staleAfterSeconds: number;
  ageSeconds: number | null;
} {
  const f = computeFreshness(asOf);
  return {
    stale: f.isStale,
    isStale: f.isStale,
    staleAfterSeconds: f.staleAfterSeconds,
    ageSeconds: f.ageSeconds,
  };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);

  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  if (typeof value === 'object' && value !== null) {
    if ('toNumber' in value && typeof (value as { toNumber: unknown }).toNumber === 'function') {
      try {
        return (value as { toNumber: () => number }).toNumber();
      } catch {
        return null;
      }
    }

    if ('toString' in value && typeof (value as { toString: unknown }).toString === 'function') {
      const n = Number((value as { toString: () => string }).toString());
      return Number.isFinite(n) ? n : null;
    }
  }

  return null;
}

type ProtocolRow = {
  slug: string;
  name: string;
  chain: string;
  venue_type: string;
  logo_url: string | null;
  tvl_usd: unknown;
  volume_24h_usd: unknown;
  fees_24h_usd: unknown;
  avg_supply_apy: unknown;
  avg_borrow_apy: unknown;
  as_of: unknown;
};

// Q4 (Lot Q): per-venue underlying-asset ranking (top by TVL) for the
// protocols page. One row per (venue, asset) from the latest reserve snapshot
// of each active entity, priced with the latest asset price.
type ProtocolAssetRow = {
  venue_slug: string;
  symbol: string | null;
  logo_url: string | null;
  tvl_usd: unknown;
  rn: unknown;
  asset_count: unknown;
};

type PoolListRow = {
  entity_slug: string;
  entity_name: string;
  entity_type: string;
  contract_address: string | null;
  protocol_slug: string;
  protocol_name: string;
  protocol_type: string;
  protocol_logo_url: string | null;
  chain: string;
  tvl_usd: unknown;
  volume_24h_usd: unknown;
  fees_24h_usd: unknown;
  total_supplied_usd: unknown;
  total_borrowed_usd: unknown;
  weighted_supply_apy: unknown;
  weighted_borrow_apy: unknown;
  metrics_metadata: unknown;
  as_of: unknown;
};

type PoolDetailRow = {
  entity_id: string;
  entity_slug: string;
  entity_name: string;
  entity_type: string;
  contract_address: string | null;
  protocol_slug: string;
  protocol_name: string;
  protocol_type: string;
  protocol_logo_url: string | null;
  chain: string;
  tvl_usd: unknown;
  volume_24h_usd: unknown;
  fees_24h_usd: unknown;
  total_supplied_usd: unknown;
  total_borrowed_usd: unknown;
  net_liquidity_usd: unknown;
  total_backstop_credit_usd: unknown;
  weighted_supply_apy: unknown;
  weighted_borrow_apy: unknown;
  metrics_metadata: unknown;
  as_of: unknown;
};

type ReserveRow = {
  asset_id: string;
  symbol: string | null;
  name: string | null;
  logo_url: string | null;
  decimals: unknown;
  d_supply_scaled: unknown;
  b_supply_scaled: unknown;
  backstop_credit_scaled: unknown;
  supply_cap_scaled: unknown;
  borrow_apr: unknown;
  est_borrow_apy: unknown;
  supply_apr: unknown;
  est_supply_apy: unknown;
  price_usd: unknown;
};

type EventCountRow = {
  events_24h: unknown;
  swaps_24h: unknown;
};

// ── Pool flows (Lot C) — whitelisted windows + shared classification SQL ──────
// Windows map to fixed Postgres intervals (bound $::interval, never
// interpolated) and to the number of daily buckets the JS gap-fill emits.
const FLOW_WINDOW_INTERVALS: Record<string, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};
const FLOW_WINDOW_DAYS: Record<string, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
};
const DEFAULT_FLOW_WINDOW = '7d';
// Coverage predicate: liquidity deposit/withdraw event families (Aquarius
// deposit_liquidity/withdraw_liquidity, Soroswap deposit/withdraw, Blend
// POOL:deposit/exit_pool, and the generic add_liquidity/remove_liquidity).
// Kept in one place so the coverage count and the bucketing classification
// never drift.
const FLOW_FAMILY_SQL = `
  event_key ilike '%deposit%'
  or event_key ilike '%withdraw%'
  or event_key ilike '%add_liquidity%'
  or event_key ilike '%remove_liquidity%'
  or event_key ilike '%exit_pool%'
`;
// H4 (Lot H): the Lot C hide rule, refined. "Covered" now means the pipeline
// can actually MEASURE flows for this pool: ≥1 flow-family event whose USD is
// computable (a non-null scaled amount on a priced asset). Amount-less rows
// (the pre-H4 Aquarius liquidity rows, whose raw values were dropped and are
// unrepairable beyond RPC retention) no longer grant coverage — they produced
// the permanent-$0 sections. Requires the `ne` alias on normalized_events.
const FLOW_COMPUTABLE_SQL = `
  (
    (ne.token_amount_in_scaled is not null
      and exists (select 1 from asset_prices ap where ap.asset_id = ne.token_in_asset_id))
    or
    (ne.token_amount_out_scaled is not null
      and exists (select 1 from asset_prices ap where ap.asset_id = ne.token_out_asset_id))
  )
`;
// H4: rows from the superseded one-day Blend backfill (numbered script 28,
// 2026-03-19 only) are excluded from flows entirely — they are not produced by
// the live pipeline (Blend's adapter is state-only) and were wrongly granting
// blend-fixed-pool a forever-$0 "covered" section.
const FLOW_LEGACY_SOURCE_SQL = `
  coalesce(ne.metadata->>'source', '') <> '28-blend-events-scaled'
`;

@Injectable()
export class StellarService {
  constructor(private readonly prisma: PrismaService) {}

  async getProtocols() {
    const rows = (await this.prisma.$queryRawUnsafe(`
      select
        v.slug,
        v.name,
        v.chain,
        v.venue_type,
        v.logo_url,
        pm.tvl_usd,
        pm.volume_24h_usd,
        pm.fees_24h_usd,
        pm.avg_supply_apy,
        pm.avg_borrow_apy,
        pm.as_of
      from venues v
      left join protocol_metrics_latest pm on pm.venue_id = v.id
      order by v.slug asc
    `)) as ProtocolRow[];

    // Q4 (Lot Q): per-venue underlying assets ranked by TVL (latest reserve
    // snapshot per entity × latest asset price). Additive — venues without
    // reserve snapshots (stellar-native keeps reserves in pool_snapshots
    // metadata) simply get an empty list, never a guessed one.
    const assetRows = (await this.prisma.$queryRawUnsafe(`
      with latest as (
        select rs.entity_id, max(rs.snapshot_at) as snapshot_at
        from reserve_snapshots rs
        join entities e on e.id = rs.entity_id and e.is_active = true
        group by rs.entity_id
      ),
      venue_assets as (
        select
          v.slug as venue_slug,
          rs.asset_id,
          sum(coalesce(rs.d_supply_scaled, 0)) as amount
        from reserve_snapshots rs
        join latest l
          on l.entity_id = rs.entity_id and l.snapshot_at = rs.snapshot_at
        join entities e on e.id = rs.entity_id
        join venues v on v.id = e.venue_id
        group by v.slug, rs.asset_id
      ),
      priced as (
        select
          va.venue_slug,
          a.symbol,
          a.logo_url,
          va.amount * coalesce(
            (
              select ap.price_usd
              from asset_prices ap
              where ap.asset_id = va.asset_id
              order by ap.observed_at desc
              limit 1
            ),
            0
          ) as tvl_usd
        from venue_assets va
        join assets a on a.id = va.asset_id
      )
      select
        venue_slug,
        symbol,
        logo_url,
        tvl_usd,
        row_number() over (partition by venue_slug order by tvl_usd desc) as rn,
        count(*) over (partition by venue_slug) as asset_count
      from priced
      order by venue_slug asc, rn asc
    `)) as ProtocolAssetRow[];

    const assetsByVenue = new Map<
      string,
      { topAssets: Array<{ symbol: string | null; logoUrl: string | null; tvlUsd: number | null }>; assetCount: number }
    >();
    for (const ar of assetRows) {
      const cur =
        assetsByVenue.get(ar.venue_slug) ??
        { topAssets: [], assetCount: toNumber(ar.asset_count) ?? 0 };
      if ((toNumber(ar.rn) ?? 0) <= 3) {
        cur.topAssets.push({
          symbol: ar.symbol,
          logoUrl: ar.logo_url ?? null,
          tvlUsd: toNumber(ar.tvl_usd),
        });
      }
      assetsByVenue.set(ar.venue_slug, cur);
    }

    return rows.map((row) => ({
      id: row.slug,
      name: row.name,
      type: row.venue_type,
      chain: row.chain,
      logoUrl: row.logo_url ?? null,
      tvlUsd: toNumber(row.tvl_usd),
      volume24hUsd: toNumber(row.volume_24h_usd) ?? 0,
      fees24hUsd: toNumber(row.fees_24h_usd) ?? 0,
      avgSupplyApy: toNumber(row.avg_supply_apy),
      avgBorrowApy: toNumber(row.avg_borrow_apy),
      // Q4: top underlying assets by TVL + honest total count for "+N" chips.
      topAssets: assetsByVenue.get(row.slug)?.topAssets ?? [],
      assetCount: assetsByVenue.get(row.slug)?.assetCount ?? 0,
      updatedAt: row.as_of,
      ...freshnessFields(row.as_of),
    }));
  }

  async getPools(protocol?: string, sort?: string, order?: 'asc' | 'desc') {
    const params: unknown[] = [];
    // Always exclude inactive entities (e.g. archived Soroban contracts whose
    // on-chain reads 404). Pushed into conditions so it is part of the WHERE,
    // not concatenated after it.
    const conditions: string[] = ['e.is_active = true'];

    if (protocol) {
      params.push(protocol);
      conditions.push(`v.slug = $${params.length}`);
    }

    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';

    const allowedSorts: Record<string, string> = {
      tvlUsd: 'pml.tvl_usd',
      volume24hUsd: 'pml.volume_24h_usd',
      fees24hUsd: 'pml.fees_24h_usd',
      supplyApy: 'pml.weighted_supply_apy',
      borrowApy: 'pml.weighted_borrow_apy',
      name: 'e.name',
      protocol: 'v.slug',
    };

    const sortColumn = sort && allowedSorts[sort] ? allowedSorts[sort] : 'v.slug, e.slug';
    const sortDirection = order === 'asc' ? 'asc' : 'desc';

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select
        e.slug as entity_slug,
        e.name as entity_name,
        e.entity_type,
        e.contract_address,
        v.slug as protocol_slug,
        v.name as protocol_name,
        v.venue_type as protocol_type,
        v.logo_url as protocol_logo_url,
        v.chain,
        pml.tvl_usd,
        pml.volume_24h_usd,
        pml.fees_24h_usd,
        pml.total_supplied_usd,
        pml.total_borrowed_usd,
        pml.weighted_supply_apy,
        pml.weighted_borrow_apy,
        pml.metadata as metrics_metadata,
        pml.as_of
      from entities e
      join venues v on v.id = e.venue_id
      left join pool_metrics_latest pml on pml.entity_id = e.id
      ${whereClause}
      order by ${sortColumn} ${sortColumn === 'v.slug, e.slug' ? '' : sortDirection}, e.slug asc
      `,
      ...params
    )) as PoolListRow[];

    // 24h swap counts for the pools table (same source as pool detail / flows:
    // normalized_events, ':trade'/':swap' keys). One grouped scan, per entity.
    // swap_events_ever distinguishes "covered, genuinely 0 in 24h" (→ 0) from
    // "events not ingested for this pool" (→ absent → null → UI dash).
    const swapRows = (await this.prisma.$queryRawUnsafe(`
      select
        e.slug as entity_slug,
        count(*) filter (
          where (ne.event_key like '%:trade' or ne.event_key like '%:swap')
            and ne.occurred_at >= now() - interval '24 hours'
        )::int as swaps_24h,
        count(*) filter (
          where ne.event_key like '%:trade' or ne.event_key like '%:swap'
        )::int as swap_events_ever
      from normalized_events ne
      join entities e on e.id = ne.entity_id
      group by e.slug
    `)) as Array<{ entity_slug: string; swaps_24h: unknown; swap_events_ever: unknown }>;

    const swapsByEntity = new Map<string, number>();
    for (const sr of swapRows) {
      if ((toNumber(sr.swap_events_ever) ?? 0) > 0) {
        swapsByEntity.set(sr.entity_slug, toNumber(sr.swaps_24h) ?? 0);
      }
    }

    const tokenRows = (await this.prisma.$queryRawUnsafe(`
      select
        e.slug as entity_slug,
        a.id as asset_id,
        a.symbol,
        a.logo_url,
        ea.role
      from entity_assets ea
      join entities e on e.id = ea.entity_id
      join assets a on a.id = ea.asset_id
      order by e.slug asc, ea.role asc, a.symbol asc
    `)) as Array<{
      entity_slug: string;
      asset_id: string;
      symbol: string | null;
      logo_url: string | null;
      role: string;
    }>;

    const tokensByEntity = new Map<
      string,
      Array<{
        assetId: string;
        symbol: string | null;
        logoUrl: string | null;
        role: string;
      }>
    >();

    for (const row of tokenRows) {
      if (!tokensByEntity.has(row.entity_slug)) {
        tokensByEntity.set(row.entity_slug, []);
      }
      tokensByEntity.get(row.entity_slug)!.push({
        assetId: row.asset_id,
        symbol: row.symbol,
        logoUrl: row.logo_url ?? null,
        role: row.role,
      });
    }

    return rows.map((row) => {
      // Honest 24h swaps: AMM pools with Soroban event coverage count from
      // normalized_events; stellar-native (Horizon, no Soroban events) reads
      // the indexer-computed trades24h from its metrics metadata — the same
      // rule pool detail applies. Lending/vaults and uncovered pools stay
      // null so the UI renders "—", never a fake zero.
      const isAmm = row.protocol_type === 'amm' || row.entity_type === 'amm_pool';
      let swaps24h: number | null = null;
      if (isAmm) {
        if (row.protocol_slug === 'stellar-native') {
          const meta = (row.metrics_metadata ?? null) as { trades24h?: unknown } | null;
          swaps24h = meta ? toNumber(meta.trades24h) : null;
        } else {
          swaps24h = swapsByEntity.get(row.entity_slug) ?? null;
        }
      }

      return {
        id: row.entity_slug,
        name: row.entity_name,
        type: row.entity_type,
        protocol: {
          id: row.protocol_slug,
          name: row.protocol_name,
          type: row.protocol_type,
          logoUrl: row.protocol_logo_url ?? null,
        },
        chain: row.chain,
        contractAddress: row.contract_address,
        tokens: tokensByEntity.get(row.entity_slug) ?? [],
        metrics: {
          tvlUsd: toNumber(row.tvl_usd),
          volume24hUsd: toNumber(row.volume_24h_usd) ?? 0,
          fees24hUsd: toNumber(row.fees_24h_usd) ?? 0,
          totalSuppliedUsd: toNumber(row.total_supplied_usd),
          totalBorrowedUsd: toNumber(row.total_borrowed_usd),
          supplyApy: toNumber(row.weighted_supply_apy),
          borrowApy: toNumber(row.weighted_borrow_apy),
          swaps24h,
        },
        updatedAt: row.as_of,
        ...freshnessFields(row.as_of),
      };
    });
  }

  async getPoolDetail(poolSlug: string) {
    try {
      const poolRows = (await this.prisma.$queryRawUnsafe(
        `
        select
          e.id as entity_id,
          e.slug as entity_slug,
          e.name as entity_name,
          e.entity_type,
          e.contract_address,
          v.slug as protocol_slug,
          v.name as protocol_name,
          v.venue_type as protocol_type,
          v.logo_url as protocol_logo_url,
          v.chain,
          pml.tvl_usd,
          pml.volume_24h_usd,
          pml.fees_24h_usd,
          pml.total_supplied_usd,
          pml.total_borrowed_usd,
          pml.net_liquidity_usd,
          pml.total_backstop_credit_usd,
          pml.weighted_supply_apy,
          pml.weighted_borrow_apy,
          pml.metadata as metrics_metadata,
          pml.as_of
        from entities e
        join venues v on v.id = e.venue_id
        left join pool_metrics_latest pml on pml.entity_id = e.id
        where e.slug = $1 and e.is_active = true
        limit 1
        `,
        poolSlug
      )) as PoolDetailRow[];

      const pool = poolRows[0];
      if (!pool) {
        throw new NotFoundException(`Pool not found: ${poolSlug}`);
      }

      const reserveRows = (await this.prisma.$queryRawUnsafe(
        `
        select
          a.id as asset_id,
          rs.symbol,
          rs.name,
          a.logo_url,
          rs.decimals,
          rs.d_supply_scaled,
          rs.b_supply_scaled,
          rs.backstop_credit_scaled,
          rs.supply_cap_scaled,
          rs.borrow_apr,
          rs.est_borrow_apy,
          rs.supply_apr,
          rs.est_supply_apy,
          (
            select ap2.price_usd
            from asset_prices ap2
            where ap2.asset_id = a.id
            order by ap2.observed_at desc
            limit 1
          ) as price_usd
        from reserve_snapshots rs
        join assets a on a.id = rs.asset_id
        where rs.entity_id = $1::uuid
          and rs.snapshot_at = (
            select max(rs2.snapshot_at)
            from reserve_snapshots rs2
            where rs2.entity_id = rs.entity_id
          )
        order by rs.symbol asc nulls last
        `,
        pool.entity_id
      )) as ReserveRow[];

      const eventCountRows = (await this.prisma.$queryRawUnsafe(
        `
        select
          count(*)::int as events_24h,
          count(*) filter (where ne.event_key like '%:trade' or ne.event_key like '%:swap')::int as swaps_24h
        from normalized_events ne
        where ne.entity_id = $1::uuid
          and ne.occurred_at >= now() - interval '24 hours'
        `,
        pool.entity_id
      )) as EventCountRow[];

      const eventCounts = eventCountRows[0] ?? null;
      const events24h = eventCounts ? toNumber(eventCounts.events_24h) : null;
      const swaps24h = eventCounts ? toNumber(eventCounts.swaps_24h) : null;

      // stellar-native pools have no Soroban events; their 24h trade count is
      // computed from Horizon trades by the indexer and stashed in the metrics
      // row metadata. Other protocols simply won't carry this key (→ null).
      const isStellarNative = pool.protocol_slug === 'stellar-native';
      const metricsMeta = (pool.metrics_metadata ?? null) as {
        trades24h?: unknown;
      } | null;
      const trades24h = metricsMeta ? toNumber(metricsMeta.trades24h) : null;

      const protocolType = pool.protocol_type;
      const entityType = pool.entity_type;
      const isAmm = protocolType === 'amm' || entityType === 'amm_pool';

      if (isAmm) {
        // Soroban AMMs (Soroswap/Aquarius) derive their tokens from
        // reserve_snapshots. stellar-native (Horizon classic) pools don't write
        // reserve_snapshots — their reserves live in pool_snapshots.metadata —
        // so resolve those separately and price each leg.
        const tokens = isStellarNative
          ? await this.getStellarNativeTokens(pool.entity_id)
          : reserveRows.map((row) => {
              const reserve = toNumber(row.d_supply_scaled);
              const priceUsd = toNumber(row.price_usd);
              const reserveUsd =
                reserve !== null && priceUsd !== null
                  ? reserve * priceUsd
                  : null;

              return {
                assetId: row.asset_id,
                symbol: row.symbol,
                name: row.name,
                logoUrl: row.logo_url ?? null,
                decimals: toNumber(row.decimals),
                priceUsd,
                reserve,
                reserveUsd,
              };
            });

        return {
          id: pool.entity_slug,
          name: pool.entity_name,
          protocol: {
            id: pool.protocol_slug,
            name: pool.protocol_name,
            type: 'amm',
            logoUrl: pool.protocol_logo_url ?? null,
          },
          chain: pool.chain,
          type: pool.entity_type,
          contractAddress: pool.contract_address,
          metrics: {
            tvlUsd: toNumber(pool.tvl_usd),
            volume24hUsd: toNumber(pool.volume_24h_usd) ?? 0,
            fees24hUsd: toNumber(pool.fees_24h_usd) ?? 0,
            events24h,
            swaps24h,
            trades24h,
          },
          tokens,
          updatedAt: pool.as_of,
          ...freshnessFields(pool.as_of),
        };
      }

      const reserves = reserveRows.map((row) => ({
        assetId: row.asset_id,
        symbol: row.symbol,
        name: row.name,
        logoUrl: row.logo_url ?? null,
        decimals: toNumber(row.decimals),
        priceUsd: toNumber(row.price_usd),
        supplied: toNumber(row.b_supply_scaled),
        borrowed: toNumber(row.d_supply_scaled),
        backstopCredit: toNumber(row.backstop_credit_scaled),
        supplyCap: toNumber(row.supply_cap_scaled),
        supplyApr: toNumber(row.supply_apr),
        supplyApy: toNumber(row.est_supply_apy),
        borrowApr: toNumber(row.borrow_apr),
        borrowApy: toNumber(row.est_borrow_apy),
      }));

      return {
        id: pool.entity_slug,
        name: pool.entity_name,
        protocol: {
          id: pool.protocol_slug,
          name: pool.protocol_name,
          type: 'lending',
          logoUrl: pool.protocol_logo_url ?? null,
        },
        chain: pool.chain,
        type: pool.entity_type,
        contractAddress: pool.contract_address,
        metrics: {
          tvlUsd: toNumber(pool.tvl_usd),
          totalSuppliedUsd: toNumber(pool.total_supplied_usd),
          totalBorrowedUsd: toNumber(pool.total_borrowed_usd),
          totalBackstopCreditUsd: toNumber(pool.total_backstop_credit_usd),
          netLiquidityUsd: toNumber(pool.net_liquidity_usd),
          supplyApy: toNumber(pool.weighted_supply_apy),
          borrowApy: toNumber(pool.weighted_borrow_apy),
          volume24hUsd: toNumber(pool.volume_24h_usd) ?? 0,
          fees24hUsd: toNumber(pool.fees_24h_usd) ?? 0,
          events24h,
        },
        reserves,
        updatedAt: pool.as_of,
        ...freshnessFields(pool.as_of),
      };
    } catch (error) {
      console.error('[StellarService.getPoolDetail] poolSlug=', poolSlug);
      console.error(error);
      throw error;
    }
  }

  // ── Inflows & outflows (Lot C) ────────────────────────────────────────────
  // On-read aggregation over normalized_events for a single pool: deposits
  // (liquidity IN) vs withdrawals (liquidity OUT), bucketed by UTC day over a
  // whitelisted window. Same shape/discipline as the /v1/bridge series:
  //  • window is a whitelisted enum → bound $2::interval, never interpolated;
  //  • the day key is emitted as a UTC 'YYYY-MM-DD' text key (avoids the
  //    timestamptz→JS-Date tz drift documented in bridge.service.ts);
  //  • JS gap-fills empty days so the chart gets a continuous axis.
  //
  // USD is derived on read (events carry no amount_usd): each event's magnitude
  // is greatest(in_scaled × latest price_in, out_scaled × latest price_out) —
  // the same max-of-legs approximation the indexer uses (prices are only a few
  // days deep, so latest-price is the honest best-effort, not historical-exact).
  //
  // "covered" is data-driven (refined in H4): a pool is covered only if it has
  // ≥1 flow-family event with COMPUTABLE USD (non-null amount on a priced
  // asset), excluding the superseded 2026-03 Blend backfill. AMMs that emit
  // only swaps/syncs, pools with no Soroban events (stellar-native, DeFindex),
  // Blend (state-only adapter), and pools whose flow rows predate amount
  // extraction all come back covered=false so the UI hides the section rather
  // than showing zeros. `coverageSince` dates the first measurable event.
  async getPoolFlows(poolSlug: string, window?: string) {
    const resolvedWindow =
      window && FLOW_WINDOW_INTERVALS[window] ? window : DEFAULT_FLOW_WINDOW;
    const interval = FLOW_WINDOW_INTERVALS[resolvedWindow];

    const poolRows = (await this.prisma.$queryRawUnsafe(
      `select id as entity_id from entities where slug = $1 and is_active = true limit 1`,
      poolSlug
    )) as Array<{ entity_id: string }>;
    const entityId = poolRows[0]?.entity_id;
    if (!entityId) {
      throw new NotFoundException(`Pool not found: ${poolSlug}`);
    }

    // Coverage (H4): ≥1 flow-family event with computable USD, excluding the
    // superseded legacy backfill. Also returns when measurable coverage began,
    // so the UI can be honest that the series only starts there (bounded by
    // Soroban getEvents retention ≈ 7 days at the time the extraction landed).
    const coverageRows = (await this.prisma.$queryRawUnsafe(
      `
      select count(*)::int as n,
             to_char(min(ne.occurred_at) at time zone 'UTC', 'YYYY-MM-DD') as since
      from normalized_events ne
      where ne.entity_id = $1::uuid
        and (${FLOW_FAMILY_SQL})
        and ${FLOW_LEGACY_SOURCE_SQL}
        and ${FLOW_COMPUTABLE_SQL}
      `,
      entityId
    )) as Array<{ n: number; since: string | null }>;
    const covered = (toNumber(coverageRows[0]?.n) ?? 0) > 0;
    const coverageSince = coverageRows[0]?.since ?? null;

    if (!covered) {
      return {
        slug: poolSlug,
        covered: false,
        window: resolvedWindow,
        days: FLOW_WINDOW_DAYS[resolvedWindow],
        coverageSince: null,
        series: [],
        totals: {
          inflowUsd: 0,
          outflowUsd: 0,
          netUsd: 0,
          depositCount: 0,
          withdrawCount: 0,
        },
        updatedAt: new Date().toISOString(),
      };
    }

    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select day, family,
             coalesce(sum(usd), 0) as usd,
             count(*)::int as n
      from (
        select
          to_char(date_trunc('day', ne.occurred_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
          case
            when ne.event_key ilike '%withdraw%'
              or ne.event_key ilike '%exit_pool%'
              or ne.event_key ilike '%remove_liquidity%' then 'outflow'
            when ne.event_key ilike '%deposit%'
              or ne.event_key ilike '%add_liquidity%' then 'inflow'
            else 'other'
          end as family,
          greatest(
            coalesce(ne.token_amount_in_scaled * pin.price_usd, 0),
            coalesce(ne.token_amount_out_scaled * pout.price_usd, 0)
          ) as usd
        from normalized_events ne
        left join lateral (
          select ap.price_usd from asset_prices ap
          where ap.asset_id = ne.token_in_asset_id
          order by ap.observed_at desc limit 1
        ) pin on true
        left join lateral (
          select ap.price_usd from asset_prices ap
          where ap.asset_id = ne.token_out_asset_id
          order by ap.observed_at desc limit 1
        ) pout on true
        where ne.entity_id = $1::uuid
          and ne.occurred_at > now() - $2::interval
          and ${FLOW_LEGACY_SOURCE_SQL}
          and (
            not (${FLOW_FAMILY_SQL.replace(/event_key/g, 'ne.event_key')})
            or ${FLOW_COMPUTABLE_SQL}
          )
      ) t
      where family <> 'other'
      group by day, family
      order by day
      `,
      entityId,
      interval
    )) as Array<{ day: string; family: string; usd: unknown; n: unknown }>;

    const days = FLOW_WINDOW_DAYS[resolvedWindow];
    const byDay = new Map<string, { inflowUsd: number; outflowUsd: number; deposits: number; withdrawals: number }>();
    for (const row of rows) {
      if (!row.day) continue;
      const usd = toNumber(row.usd) ?? 0;
      const n = toNumber(row.n) ?? 0;
      const entry = byDay.get(row.day) ?? { inflowUsd: 0, outflowUsd: 0, deposits: 0, withdrawals: 0 };
      if (row.family === 'inflow') { entry.inflowUsd += usd; entry.deposits += n; }
      else if (row.family === 'outflow') { entry.outflowUsd += usd; entry.withdrawals += n; }
      byDay.set(row.day, entry);
    }

    const series: Array<{
      day: string;
      inflowUsd: number;
      outflowUsd: number;
      netUsd: number;
      cumulativeNetUsd: number;
    }> = [];
    let inflowUsd = 0;
    let outflowUsd = 0;
    let depositCount = 0;
    let withdrawCount = 0;
    let cumulative = 0;
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const hit = byDay.get(key) ?? { inflowUsd: 0, outflowUsd: 0, deposits: 0, withdrawals: 0 };
      const dayIn = Number(hit.inflowUsd.toFixed(2));
      const dayOut = Number(hit.outflowUsd.toFixed(2));
      const net = Number((dayIn - dayOut).toFixed(2));
      cumulative = Number((cumulative + net).toFixed(2));
      inflowUsd += dayIn;
      outflowUsd += dayOut;
      depositCount += hit.deposits;
      withdrawCount += hit.withdrawals;
      series.push({ day: key, inflowUsd: dayIn, outflowUsd: dayOut, netUsd: net, cumulativeNetUsd: cumulative });
    }

    return {
      slug: poolSlug,
      covered: true,
      window: resolvedWindow,
      days,
      coverageSince,
      series,
      totals: {
        inflowUsd: Number(inflowUsd.toFixed(2)),
        outflowUsd: Number(outflowUsd.toFixed(2)),
        netUsd: Number((inflowUsd - outflowUsd).toFixed(2)),
        depositCount,
        withdrawCount,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  // ── TVL history series (Lot C) ────────────────────────────────────────────
  // Blend-only, honest reconstruction. No stored USD time-series exists in the
  // DB (pool_metrics_latest is a single-row upsert), but Blend lending pools
  // retain per-asset reserve history in reserve_snapshots. We reconstruct TVL
  // per snapshot as sum(d_supply_scaled × latest asset price) — a degraded,
  // irregular-cadence, latest-price approximation (asset_prices is only ~18 days
  // deep). AMM/native/vault pools have no usable reserve history → covered=false
  // so the UI keeps the honest "building history" note rather than a fake curve.
  //
  // Volume history does not exist for any pool, so this series is TVL-only.
  async getPoolSeries(poolSlug: string) {
    const poolRows = (await this.prisma.$queryRawUnsafe(
      `
      select e.id as entity_id, e.entity_type, v.venue_type
      from entities e
      join venues v on v.id = e.venue_id
      where e.slug = $1 and e.is_active = true
      limit 1
      `,
      poolSlug
    )) as Array<{ entity_id: string; entity_type: string; venue_type: string }>;
    const pool = poolRows[0];
    if (!pool) {
      throw new NotFoundException(`Pool not found: ${poolSlug}`);
    }

    const isLending =
      pool.venue_type === 'lending' || pool.entity_type === 'lending_pool';
    if (!isLending) {
      return {
        slug: poolSlug,
        covered: false,
        kind: 'tvl',
        points: [],
        first: null,
        last: null,
        updatedAt: new Date().toISOString(),
      };
    }

    // One TVL value per distinct snapshot; keep the last snapshot per UTC day in
    // JS for a clean daily line. Latest-price per asset (documented approximation).
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select
        rs.snapshot_at,
        to_char(date_trunc('day', rs.snapshot_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
        sum(rs.d_supply_scaled * coalesce(p.price_usd, 0)) as tvl_usd
      from reserve_snapshots rs
      join lateral (
        select ap.price_usd from asset_prices ap
        where ap.asset_id = rs.asset_id
        order by ap.observed_at desc limit 1
      ) p on true
      where rs.entity_id = $1::uuid
      group by rs.snapshot_at
      order by rs.snapshot_at asc
      `,
      pool.entity_id
    )) as Array<{ snapshot_at: Date; day: string; tvl_usd: unknown }>;

    // Reduce to one point per UTC day (last snapshot of the day wins).
    const byDay = new Map<string, number>();
    for (const row of rows) {
      const tvl = toNumber(row.tvl_usd);
      if (tvl === null) continue;
      byDay.set(row.day, Number(tvl.toFixed(2)));
    }
    const points = [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, tvlUsd]) => ({ day, tvlUsd }));

    const covered = points.length >= 2;
    return {
      slug: poolSlug,
      covered,
      kind: 'tvl',
      points,
      first: points[0]?.day ?? null,
      last: points[points.length - 1]?.day ?? null,
      updatedAt: new Date().toISOString(),
    };
  }

  // Build the token/reserve breakdown for a stellar-native (Horizon classic)
  // pool. Reserves are stored in the latest pool_snapshots.metadata in Horizon
  // asset format ("native" / "CODE:ISSUER") with human-unit amounts. We resolve
  // each leg to its SAC contract to look up the asset row + latest USD price,
  // then return tokens shaped like the Soroban AMM path (assetId/symbol/name/
  // decimals/priceUsd/reserve/reserveUsd) so the UI mapper stays uniform.
  private async getStellarNativeTokens(entityId: string) {
    const snapRows = (await this.prisma.$queryRawUnsafe(
      `
      select ps.metadata
      from pool_snapshots ps
      where ps.entity_id = $1::uuid
      order by ps.snapshot_at desc
      limit 1
      `,
      entityId
    )) as Array<{
      metadata: { reserves?: Array<{ asset: string; amount: string }> } | null;
    }>;

    const reserves = snapRows[0]?.metadata?.reserves ?? [];
    if (!reserves.length) return [];

    const resolved = reserves.map((r) => ({
      amount: toNumber(r.amount),
      symbol: r.asset === 'native' ? 'XLM' : r.asset.split(':')[0],
      contract: horizonAssetToSacContractId(r.asset),
    }));

    const contracts = resolved
      .map((r) => r.contract)
      .filter((c): c is string => c !== null);

    const assetRows = contracts.length
      ? ((await this.prisma.$queryRawUnsafe(
          `
          select
            a.contract_address,
            a.id,
            a.symbol,
            a.name,
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
          contracts
        )) as Array<{
          contract_address: string;
          id: string;
          symbol: string | null;
          name: string | null;
          decimals: unknown;
          price_usd: unknown;
        }>)
      : [];

    const assetByContract = new Map(
      assetRows.map((a) => [a.contract_address, a])
    );

    return resolved.map((r) => {
      const asset = r.contract ? assetByContract.get(r.contract) : undefined;
      const priceUsd = asset ? toNumber(asset.price_usd) : null;
      const reserve = r.amount;
      const reserveUsd =
        reserve !== null && priceUsd !== null ? reserve * priceUsd : null;

      return {
        assetId: asset?.id ?? null,
        symbol: asset?.symbol ?? r.symbol,
        name: asset?.name ?? null,
        decimals: asset ? toNumber(asset.decimals) : null,
        priceUsd,
        reserve,
        reserveUsd,
      };
    });
  }
}