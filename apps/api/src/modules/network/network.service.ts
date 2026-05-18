// apps/api/src/modules/network/network.service.ts
import { Injectable, Logger } from '@nestjs/common';

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
  updatedAt: string;
};

type CoinGeckoPriceResponse = {
  stellar?: {
    usd?: number;
    usd_24h_change?: number;
  };
};

type DefiLlamaChainRow = {
  name: string;
  tvl: number;
};

type StablecoinChainRow = {
  name: string;
  totalCirculatingUSD?: {
    peggedUSD?: number;
  };
};

type StellarExpertSummaryResponse = {
  accounts?: number;
  dex_volume?: number;
};

type StellarExpertSupplyResponse = {
  issued?: number;
};

type HorizonFeeStatsResponse = {
  fee_charged?: {
    mode?: string;
  };
};

@Injectable()
export class NetworkService {
  private readonly logger = new Logger(NetworkService.name);
  private readonly REQUEST_TIMEOUT_MS = 6_000;

  async getNetworkStats(): Promise<NetworkStatsResponse> {
    const [
      xlmPrice,
      stellarTvl,
      stableMcap,
      stellarExpertSummary,
      usdcSupply,
      avgTxFeeXlm,
    ] = await Promise.all([
      this.safeGetXlmPrice(),
      this.safeGetStellarTvl(),
      this.safeGetStableMcap(),
      this.safeGetStellarExpertSummary(),
      this.safeGetUsdcSupply(),
      this.safeGetAvgTxFee(),
    ]);

    return {
      xlmPriceUsd: xlmPrice.priceUsd,
      xlmPriceChange24hPct: xlmPrice.change24hPct,
      stellarTvlUsd: stellarTvl,
      activeWallets: stellarExpertSummary.activeWallets,
      stableMcapUsd: stableMcap,
      dexVolume24hUsd: stellarExpertSummary.dexVolume24hUsd,
      protocolCount: 3,
      usdcSupplyUsd: usdcSupply,
      avgTxFeeXlm,
      updatedAt: new Date().toISOString(),
    };
  }

  private async fetchJsonWithTimeout<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} on ${url}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async safeGetXlmPrice(): Promise<{
    priceUsd: number | null;
    change24hPct: number | null;
  }> {
    try {
      const data = await this.fetchJsonWithTimeout<CoinGeckoPriceResponse>(
        'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd&include_24hr_change=true'
      );

      return {
        priceUsd: this.toFiniteNumber(data?.stellar?.usd),
        change24hPct: this.toFiniteNumber(data?.stellar?.usd_24h_change),
      };
    } catch (error) {
      this.logger.warn(`safeGetXlmPrice failed: ${this.getErrorMessage(error)}`);
      return {
        priceUsd: null,
        change24hPct: null,
      };
    }
  }

  private async safeGetStellarTvl(): Promise<number | null> {
    try {
      const data = await this.fetchJsonWithTimeout<DefiLlamaChainRow[]>(
        'https://api.llama.fi/v2/chains'
      );

      const stellar = data.find((row) => row.name === 'Stellar');
      return this.toFiniteNumber(stellar?.tvl);
    } catch (error) {
      this.logger.warn(`safeGetStellarTvl failed: ${this.getErrorMessage(error)}`);
      return null;
    }
  }

  private async safeGetStableMcap(): Promise<number | null> {
    try {
      const data = await this.fetchJsonWithTimeout<StablecoinChainRow[]>(
        'https://stablecoins.llama.fi/stablecoinchains'
      );

      const stellar = data.find((row) => row.name === 'Stellar');
      return this.toFiniteNumber(stellar?.totalCirculatingUSD?.peggedUSD);
    } catch (error) {
      this.logger.warn(`safeGetStableMcap failed: ${this.getErrorMessage(error)}`);
      return null;
    }
  }

  private async safeGetStellarExpertSummary(): Promise<{
    activeWallets: number | null;
    dexVolume24hUsd: number | null;
  }> {
    try {
      const data = await this.fetchJsonWithTimeout<StellarExpertSummaryResponse>(
        'https://api.stellar.expert/explorer/public/network-activity/summary'
      );

      return {
        activeWallets: this.toFiniteNumber(data?.accounts),
        dexVolume24hUsd: this.toFiniteNumber(data?.dex_volume),
      };
    } catch (error) {
      this.logger.warn(`safeGetStellarExpertSummary failed: ${this.getErrorMessage(error)}`);
      return {
        activeWallets: null,
        dexVolume24hUsd: null,
      };
    }
  }

  private async safeGetUsdcSupply(): Promise<number | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);
  
    try {
      const response = await fetch(
        'https://api.stellar.expert/explorer/public/asset/USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/supply',
        {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Accept: 'text/plain, application/json',
          },
        }
      );
  
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} on USDC supply endpoint`);
      }
  
      const raw = (await response.text()).trim();
  
      if (!raw) {
        return null;
      }
  
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        this.logger.warn(`safeGetUsdcSupply received non-numeric payload: ${raw}`);
        return null;
      }
  
      return value;
    } catch (error) {
      this.logger.warn(`safeGetUsdcSupply failed: ${this.getErrorMessage(error)}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async safeGetAvgTxFee(): Promise<number | null> {
    try {
      const data = await this.fetchJsonWithTimeout<HorizonFeeStatsResponse>(
        'https://horizon.stellar.org/fee_stats'
      );

      const mode = data?.fee_charged?.mode;
      if (!mode) return null;

      const stroops = Number.parseInt(mode, 10);
      if (!Number.isFinite(stroops)) return null;

      return stroops / 10_000_000;
    } catch (error) {
      this.logger.warn(`safeGetAvgTxFee failed: ${this.getErrorMessage(error)}`);
      return null;
    }
  }

  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}