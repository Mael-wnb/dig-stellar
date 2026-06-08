// apps/api/src/modules/network/network.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

export type NetworkStatsResponse = {
  xlmPriceUsd: number | null;
  xlmPriceChange24hPct: number | null;
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
      if ('toNumber' in value && typeof (value as { toNumber: unknown }).toNumber === 'function') {
        try {
          const n = (value as { toNumber: () => number }).toNumber();
          return Number.isFinite(n) ? n : null;
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
}
