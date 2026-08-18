// apps/api/src/modules/network/network.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { computeFreshness, staleAfterSeconds } from '../../common/freshness';

export type NetworkStatsResponse = {
  xlmPriceUsd: number | null;
  xlmPriceChange24hPct: number | null;
  // Since 2026-08-17: our canonical tracked-network sum (latest
  // network_tvl_snapshots point, copied in by the indexer) — not DefiLlama.
  stellarTvlUsd: number | null;
  activeWallets: number | null;
  stableMcapUsd: number | null;
  dexVolume24hUsd: number | null;
  protocolCount: number;
  usdcSupplyUsd: number | null;
  avgTxFeeXlm: number | null;
  // null when the indexer has never populated network_stats_latest yet
  // (cold start). Otherwise the real as_of of the stored row.
  updatedAt: string | null;
  // Freshness (T3-D1): stale when as_of is older than
  // FRESHNESS_STALE_AFTER_MINUTES; null at cold start (no row yet).
  isStale: boolean | null;
  staleAfterSeconds: number;
};

type NetworkStatsRow = {
  as_of: unknown;
  xlm_price_usd: unknown;
  xlm_price_change_24h_pct: unknown;
  stellar_tvl_usd: unknown;
  active_wallets: unknown;
  stable_mcap_usd: unknown;
  dex_volume_24h_usd: unknown;
  usdc_supply_usd: unknown;
  avg_tx_fee_xlm: unknown;
  protocol_count: unknown;
};

// G4 (Lot G / T3-D3): network TVL history read from network_tvl_snapshots (G0).
// Since the 2026-08-17 ruling this is the single TVL source for BOTH the hero
// (latest point) and the chart (series) — "Total value tracked", gross, with
// DeFindex excluded from the sum. See stellar_v1_network_tvl.sql.
export type NetworkTvlPoint = {
  t: string; // hour bucket, ISO
  tvlUsd: number; // gross — "Total value tracked"
  // Net TVL (supplied − borrowed), same snapshot. null on points written before
  // the 2026-08-17 methodology change — history is never rewritten.
  tvlNetUsd: number | null;
  protocolCount: number;
};

export type NetworkTvlSeriesResponse = {
  series: NetworkTvlPoint[];
  meta: {
    source: 'snapshots';
    from: string; // window start (ISO) = to − 7d
    to: string; // window end (ISO) = now
    // Earliest snapshot ever stored — drives the honest "building history since"
    // note while the 7d window isn't yet fully covered. null before the first row.
    firstSnapshotAt: string | null;
    // true while history is younger than the window (curve still filling in).
    partial: boolean;
    bucket: 'hour';
    // First snapshot written under the 2026-08-17 definition (gross tracked sum,
    // DeFindex excluded). Non-null only when older pre-change points also exist —
    // it marks the definitional step-down in the curve so the chart can footnote
    // it honestly instead of rewriting history.
    methodologyChangeAt: string | null;
  };
};

type TvlBucketRow = {
  bucket: unknown;
  tvl_usd: unknown;
  tvl_net_usd: unknown;
  protocol_count: unknown;
};

@Injectable()
export class NetworkService {
  constructor(private readonly prisma: PrismaService) {}

  // Reads the latest network stats from the DB (network_stats_latest, scope
  // 'global'), populated periodically by the indexer's
  // run-network-stats-refresh step. No external calls at request time.
  async getNetworkStats(): Promise<NetworkStatsResponse> {
    const rows = (await this.prisma.$queryRawUnsafe(`
      select
        as_of,
        xlm_price_usd,
        xlm_price_change_24h_pct,
        stellar_tvl_usd,
        active_wallets,
        stable_mcap_usd,
        dex_volume_24h_usd,
        usdc_supply_usd,
        avg_tx_fee_xlm,
        protocol_count
      from network_stats_latest
      where scope = 'global'
      limit 1
    `)) as NetworkStatsRow[];

    const row = rows[0];

    // Cold start: indexer has never run the step yet -> all-null payload with
    // updatedAt null. Same shape, never an error.
    if (!row) {
      return {
        xlmPriceUsd: null,
        xlmPriceChange24hPct: null,
        stellarTvlUsd: null,
        activeWallets: null,
        stableMcapUsd: null,
        dexVolume24hUsd: null,
        protocolCount: 3,
        usdcSupplyUsd: null,
        avgTxFeeXlm: null,
        updatedAt: null,
        isStale: null,
        staleAfterSeconds: staleAfterSeconds(),
      };
    }

    return {
      xlmPriceUsd: this.toFiniteNumber(row.xlm_price_usd),
      xlmPriceChange24hPct: this.toFiniteNumber(row.xlm_price_change_24h_pct),
      stellarTvlUsd: this.toFiniteNumber(row.stellar_tvl_usd),
      activeWallets: this.toFiniteNumber(row.active_wallets),
      stableMcapUsd: this.toFiniteNumber(row.stable_mcap_usd),
      dexVolume24hUsd: this.toFiniteNumber(row.dex_volume_24h_usd),
      protocolCount: this.toFiniteNumber(row.protocol_count) ?? 3,
      usdcSupplyUsd: this.toFiniteNumber(row.usdc_supply_usd),
      avgTxFeeXlm: this.toFiniteNumber(row.avg_tx_fee_xlm),
      updatedAt: this.toIsoString(row.as_of),
      isStale: computeFreshness(row.as_of).isStale,
      staleAfterSeconds: staleAfterSeconds(),
    };
  }

  // Network TVL 7-day series (G4). On-read aggregation over G0's
  // network_tvl_snapshots — no external calls. Hourly buckets: the latest
  // snapshot in each hour represents that hour's TVL. Missing hours are simply
  // absent from the series (gaps stay gaps — the chart never interpolates).
  async getTvlSeries(): Promise<NetworkTvlSeriesResponse> {
    const WINDOW_DAYS = 7;
    const to = new Date();
    const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // One row per hour that has data: distinct on the hour bucket, keeping the
    // latest snapshot within it (as_of desc). Ordered oldest→newest for drawing.
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      select distinct on (date_trunc('hour', as_of))
        date_trunc('hour', as_of) as bucket,
        tvl_usd,
        tvl_net_usd,
        protocol_count
      from network_tvl_snapshots
      where as_of >= $1::timestamptz
      order by date_trunc('hour', as_of) asc, as_of desc
      `,
      from.toISOString(),
    )) as TvlBucketRow[];

    const series: NetworkTvlPoint[] = [];
    for (const row of rows) {
      const t = this.toIsoString(row.bucket);
      const tvlUsd = this.toFiniteNumber(row.tvl_usd);
      if (t === null || tvlUsd === null) continue; // never emit a broken point
      series.push({
        t,
        tvlUsd,
        tvlNetUsd: this.toFiniteNumber(row.tvl_net_usd),
        protocolCount: this.toFiniteNumber(row.protocol_count) ?? 0,
      });
    }

    // first = earliest snapshot ever; first_v2 = earliest snapshot carrying the
    // 2026-08-17 definition (tvl_net_usd non-null). A changeover exists only
    // when pre-change rows precede it.
    const firstRows = (await this.prisma.$queryRawUnsafe(
      `
      select
        min(as_of) as first,
        min(as_of) filter (where tvl_net_usd is not null) as first_v2
      from network_tvl_snapshots
      `,
    )) as Array<{ first: unknown; first_v2: unknown }>;
    const firstSnapshotAt = this.toIsoString(firstRows[0]?.first ?? null);
    const firstV2At = this.toIsoString(firstRows[0]?.first_v2 ?? null);
    const methodologyChangeAt =
      firstSnapshotAt !== null &&
      firstV2At !== null &&
      new Date(firstSnapshotAt).getTime() < new Date(firstV2At).getTime()
        ? firstV2At
        : null;

    // Partial while history began after the window opened (or there is none yet)
    // — i.e. the 7-day curve isn't fully backed by data. Drives the honest note.
    const partial =
      firstSnapshotAt === null ||
      new Date(firstSnapshotAt).getTime() > from.getTime();

    return {
      series,
      meta: {
        source: 'snapshots',
        from: from.toISOString(),
        to: to.toISOString(),
        firstSnapshotAt,
        partial,
        bucket: 'hour',
        methodologyChangeAt,
      },
    };
  }

  private toIsoString(value: unknown): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim().length > 0) return value;
    return null;
  }

  private toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'bigint') {
      return Number(value);
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    // Postgres `numeric` columns read via prisma.$queryRawUnsafe come back as
    // Prisma.Decimal objects (not number/string), so unwrap them via
    // toNumber()/toString() — same approach as stellar.service.ts.
    if (typeof value === 'object') {
      if (
        'toNumber' in value &&
        typeof (value as { toNumber: unknown }).toNumber === 'function'
      ) {
        try {
          const n = (value as { toNumber: () => number }).toNumber();
          return Number.isFinite(n) ? n : null;
        } catch {
          return null;
        }
      }

      if (
        'toString' in value &&
        typeof (value as { toString: unknown }).toString === 'function'
      ) {
        const n = Number((value as { toString: () => string }).toString());
        return Number.isFinite(n) ? n : null;
      }
    }

    return null;
  }
}
