// apps/indexer/src/scripts/ingest/73-network-stats-refresh.ts
//
// Fetches network-wide Stellar stats from external providers and upserts them
// into network_stats_latest (single row, scope='global'). Read by the API at
// GET /v1/network/stats.
//
// NOTE: the safeGet* fetchers below are intentionally COPIED from the previous
// apps/api NetworkService (not shared) — api and indexer are separate apps by
// design. Each fetcher keeps its own try/catch -> null so one failing provider
// never breaks the others. This whole script is also run NON-FATALLY by
// 71-refresh-all-metrics.ts.

import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';

const REQUEST_TIMEOUT_MS = 6_000;

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

type HorizonFeeStatsResponse = {
  fee_charged?: {
    mode?: string;
  };
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

async function fetchJsonWithTimeout<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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

async function safeGetXlmPrice(): Promise<{
  priceUsd: number | null;
  change24hPct: number | null;
}> {
  try {
    const data = await fetchJsonWithTimeout<CoinGeckoPriceResponse>(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd&include_24hr_change=true'
    );

    return {
      priceUsd: toFiniteNumber(data?.stellar?.usd),
      change24hPct: toFiniteNumber(data?.stellar?.usd_24h_change),
    };
  } catch (error) {
    console.warn(`safeGetXlmPrice failed: ${getErrorMessage(error)}`);
    return {
      priceUsd: null,
      change24hPct: null,
    };
  }
}

async function safeGetStellarTvl(): Promise<number | null> {
  try {
    const data = await fetchJsonWithTimeout<DefiLlamaChainRow[]>(
      'https://api.llama.fi/v2/chains'
    );

    const stellar = data.find((row) => row.name === 'Stellar');
    return toFiniteNumber(stellar?.tvl);
  } catch (error) {
    console.warn(`safeGetStellarTvl failed: ${getErrorMessage(error)}`);
    return null;
  }
}

async function safeGetStableMcap(): Promise<number | null> {
  try {
    const data = await fetchJsonWithTimeout<StablecoinChainRow[]>(
      'https://stablecoins.llama.fi/stablecoinchains'
    );

    const stellar = data.find((row) => row.name === 'Stellar');
    return toFiniteNumber(stellar?.totalCirculatingUSD?.peggedUSD);
  } catch (error) {
    console.warn(`safeGetStableMcap failed: ${getErrorMessage(error)}`);
    return null;
  }
}

async function safeGetStellarExpertSummary(): Promise<{
  activeWallets: number | null;
  dexVolume24hUsd: number | null;
}> {
  try {
    const data = await fetchJsonWithTimeout<StellarExpertSummaryResponse>(
      'https://api.stellar.expert/explorer/public/network-activity/summary'
    );

    return {
      activeWallets: toFiniteNumber(data?.accounts),
      dexVolume24hUsd: toFiniteNumber(data?.dex_volume),
    };
  } catch (error) {
    console.warn(`safeGetStellarExpertSummary failed: ${getErrorMessage(error)}`);
    return {
      activeWallets: null,
      dexVolume24hUsd: null,
    };
  }
}

async function safeGetUsdcSupply(): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
      console.warn(`safeGetUsdcSupply received non-numeric payload: ${raw}`);
      return null;
    }

    return value;
  } catch (error) {
    console.warn(`safeGetUsdcSupply failed: ${getErrorMessage(error)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function safeGetAvgTxFee(): Promise<number | null> {
  try {
    const data = await fetchJsonWithTimeout<HorizonFeeStatsResponse>(
      'https://horizon.stellar.org/fee_stats'
    );

    const mode = data?.fee_charged?.mode;
    if (!mode) return null;

    const stroops = Number.parseInt(mode, 10);
    if (!Number.isFinite(stroops)) return null;

    return stroops / 10_000_000;
  } catch (error) {
    console.warn(`safeGetAvgTxFee failed: ${getErrorMessage(error)}`);
    return null;
  }
}

async function main(): Promise<void> {
  const [
    xlmPrice,
    stellarTvl,
    stableMcap,
    stellarExpertSummary,
    usdcSupply,
    avgTxFeeXlm,
  ] = await Promise.all([
    safeGetXlmPrice(),
    safeGetStellarTvl(),
    safeGetStableMcap(),
    safeGetStellarExpertSummary(),
    safeGetUsdcSupply(),
    safeGetAvgTxFee(),
  ]);

  const asOf = nowIso();
  const client = createPgClient();
  await client.connect();

  try {
    // "protocols with live aggregated metrics" — count the rows written by
    // step 70 (70-protocol-persist-metrics), which runs before this step in
    // 71-refresh-all-metrics. Dynamic so it stays correct as protocols are
    // added, instead of a hardcoded literal.
    const protocolCountRes = await client.query(
      `select count(*)::int as n from protocol_metrics_latest`
    );
    const protocolCount = (protocolCountRes.rows[0]?.n as number) ?? 0;

    await client.query(
      `
      insert into network_stats_latest (
        scope,
        as_of,
        xlm_price_usd,
        xlm_price_change_24h_pct,
        stellar_tvl_usd,
        active_wallets,
        stable_mcap_usd,
        dex_volume_24h_usd,
        usdc_supply_usd,
        avg_tx_fee_xlm,
        protocol_count,
        metadata
      )
      values ('global',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      on conflict (scope)
      do update set
        as_of = excluded.as_of,
        xlm_price_usd = excluded.xlm_price_usd,
        xlm_price_change_24h_pct = excluded.xlm_price_change_24h_pct,
        stellar_tvl_usd = excluded.stellar_tvl_usd,
        active_wallets = excluded.active_wallets,
        stable_mcap_usd = excluded.stable_mcap_usd,
        dex_volume_24h_usd = excluded.dex_volume_24h_usd,
        usdc_supply_usd = excluded.usdc_supply_usd,
        avg_tx_fee_xlm = excluded.avg_tx_fee_xlm,
        protocol_count = excluded.protocol_count,
        metadata = excluded.metadata,
        updated_at = now()
      `,
      [
        asOf,
        xlmPrice.priceUsd,
        xlmPrice.change24hPct,
        stellarTvl,
        stellarExpertSummary.activeWallets,
        stableMcap,
        stellarExpertSummary.dexVolume24hUsd,
        usdcSupply,
        avgTxFeeXlm,
        protocolCount,
        JSON.stringify({ source: '73-network-stats-refresh' }),
      ]
    );

    console.log({
      step: '73-network-stats-refresh',
      asOf,
      xlmPriceUsd: xlmPrice.priceUsd,
      xlmPriceChange24hPct: xlmPrice.change24hPct,
      stellarTvlUsd: stellarTvl,
      activeWallets: stellarExpertSummary.activeWallets,
      stableMcapUsd: stableMcap,
      dexVolume24hUsd: stellarExpertSummary.dexVolume24hUsd,
      usdcSupplyUsd: usdcSupply,
      avgTxFeeXlm,
      protocolCount,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
