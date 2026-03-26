// apps/api/src/modules/stellar/stellar.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

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
  tvl_usd: unknown;
  volume_24h_usd: unknown;
  fees_24h_usd: unknown;
  avg_supply_apy: unknown;
  avg_borrow_apy: unknown;
  as_of: unknown;
};

type PoolListRow = {
  entity_slug: string;
  entity_name: string;
  entity_type: string;
  contract_address: string | null;
  protocol_slug: string;
  protocol_name: string;
  protocol_type: string;
  chain: string;
  tvl_usd: unknown;
  volume_24h_usd: unknown;
  fees_24h_usd: unknown;
  total_supplied_usd: unknown;
  total_borrowed_usd: unknown;
  weighted_supply_apy: unknown;
  weighted_borrow_apy: unknown;
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
  as_of: unknown;
};

type ReserveRow = {
  asset_id: string;
  symbol: string | null;
  name: string | null;
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

    return rows.map((row) => ({
      id: row.slug,
      name: row.name,
      type: row.venue_type,
      chain: row.chain,
      tvlUsd: toNumber(row.tvl_usd),
      volume24hUsd: toNumber(row.volume_24h_usd) ?? 0,
      fees24hUsd: toNumber(row.fees_24h_usd) ?? 0,
      avgSupplyApy: toNumber(row.avg_supply_apy),
      avgBorrowApy: toNumber(row.avg_borrow_apy),
      updatedAt: row.as_of,
    }));
  }

  async getPools(protocol?: string, sort?: string, order?: 'asc' | 'desc') {
    const params: unknown[] = [];
    const conditions: string[] = [];

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
        v.chain,
        pml.tvl_usd,
        pml.volume_24h_usd,
        pml.fees_24h_usd,
        pml.total_supplied_usd,
        pml.total_borrowed_usd,
        pml.weighted_supply_apy,
        pml.weighted_borrow_apy,
        pml.as_of
      from entities e
      join venues v on v.id = e.venue_id
      left join pool_metrics_latest pml on pml.entity_id = e.id
      ${whereClause}
      order by ${sortColumn} ${sortColumn === 'v.slug, e.slug' ? '' : sortDirection}, e.slug asc
      `,
      ...params
    )) as PoolListRow[];

    const tokenRows = (await this.prisma.$queryRawUnsafe(`
      select
        e.slug as entity_slug,
        a.id as asset_id,
        a.symbol,
        ea.role
      from entity_assets ea
      join entities e on e.id = ea.entity_id
      join assets a on a.id = ea.asset_id
      order by e.slug asc, ea.role asc, a.symbol asc
    `)) as Array<{
      entity_slug: string;
      asset_id: string;
      symbol: string | null;
      role: string;
    }>;

    const tokensByEntity = new Map<
      string,
      Array<{ assetId: string; symbol: string | null; role: string }>
    >();

    for (const row of tokenRows) {
      if (!tokensByEntity.has(row.entity_slug)) {
        tokensByEntity.set(row.entity_slug, []);
      }
      tokensByEntity.get(row.entity_slug)!.push({
        assetId: row.asset_id,
        symbol: row.symbol,
        role: row.role,
      });
    }

    return rows.map((row) => ({
      id: row.entity_slug,
      name: row.entity_name,
      type: row.entity_type,
      protocol: {
        id: row.protocol_slug,
        name: row.protocol_name,
        type: row.protocol_type,
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
      },
      updatedAt: row.as_of,
    }));
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
          pml.as_of
        from entities e
        join venues v on v.id = e.venue_id
        left join pool_metrics_latest pml on pml.entity_id = e.id
        where e.slug = $1
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

      const protocolType = pool.protocol_type;
      const entityType = pool.entity_type;
      const isAmm = protocolType === 'amm' || entityType === 'amm_pool';

      if (isAmm) {
        const tokens = reserveRows.map((row) => {
          const reserve = toNumber(row.d_supply_scaled);
          const priceUsd = toNumber(row.price_usd);
          const reserveUsd =
            reserve !== null && priceUsd !== null ? reserve * priceUsd : null;

          return {
            assetId: row.asset_id,
            symbol: row.symbol,
            name: row.name,
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
          },
          tokens,
          updatedAt: pool.as_of,
        };
      }

      const reserves = reserveRows.map((row) => ({
        assetId: row.asset_id,
        symbol: row.symbol,
        name: row.name,
        decimals: toNumber(row.decimals),
        priceUsd: toNumber(row.price_usd),
        supplied: toNumber(row.d_supply_scaled),
        borrowed: toNumber(row.b_supply_scaled),
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
      };
    } catch (error) {
      console.error('[StellarService.getPoolDetail] poolSlug=', poolSlug);
      console.error(error);
      throw error;
    }
  }
}