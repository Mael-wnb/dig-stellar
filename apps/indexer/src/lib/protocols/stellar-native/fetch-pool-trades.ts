// apps/indexer/src/lib/protocols/stellar-native/fetch-pool-trades.ts

import "dotenv/config";
import { fetchJson } from "../../../scripts/discovery/00-common";
import { maskHorizonUrl, maskRpcUrl } from "../../rpc-config";

export type PoolTradeMetrics = {
  volume24hUsd: number;
  fees24hUsd: number;
  trades24h: number;
};

type HorizonTrade = {
  ledger_close_time: string;
  base_amount: string;
  base_asset_type: string;
  base_asset_code?: string;
  base_asset_issuer?: string;
  counter_amount: string;
  counter_asset_type: string;
  counter_asset_code?: string;
  counter_asset_issuer?: string;
};

type HorizonTradesResponse = {
  _embedded?: { records?: HorizonTrade[] };
  _links?: { next?: { href?: string } };
};

/** Same shape as `fetchJson` — injectable so the walk is unit-testable. */
export type TradesPageFetcher = (url: string) => Promise<HorizonTradesResponse>;

const STABLE_USD: Record<string, number> = {
  USDC: 1,
  EURC: 1.16,
};

const WINDOW_MS = 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 200;
const MAX_PAGES = 25;

function legUnitUsd(
  assetType: string,
  assetCode: string | undefined,
  xlmUsd: number | null
): number | null {
  if (assetType === "native") {
    return xlmUsd;
  }

  if (assetCode && assetCode in STABLE_USD) {
    return STABLE_USD[assetCode];
  }

  return null;
}

function tradeUsd(
  trade: HorizonTrade,
  xlmUsd: number | null
): number | null {
  const baseUnit = legUnitUsd(
    trade.base_asset_type,
    trade.base_asset_code,
    xlmUsd
  );

  if (baseUnit !== null) {
    return Number(trade.base_amount) * baseUnit;
  }

  const counterUnit = legUnitUsd(
    trade.counter_asset_type,
    trade.counter_asset_code,
    xlmUsd
  );

  if (counterUnit !== null) {
    return Number(trade.counter_amount) * counterUnit;
  }

  return null;
}

/** HORIZON_TRADES_URL, else HORIZON_URL, else public Horizon; blank = unset. */
function resolveTradesBaseUrl(): string {
  return (
    process.env.HORIZON_TRADES_URL?.trim() ||
    process.env.HORIZON_URL?.trim() ||
    "https://horizon.stellar.org"
  );
}

/**
 * Walk a pool's trades back over the last 24 h and sum them in USD.
 *
 * Pages go through HORIZON_TRADES_URL (the operator provider, Lot PRE PRE2) and
 * fall back to HORIZON_URL / public Horizon when it is unset. The provider URL
 * carries a key in its path: every log line here goes through maskRpcUrl /
 * maskHorizonUrl (host, or host + Horizon path) — never the raw URL.
 *
 * Returns null when a page ultimately fails (fetchJson's retries exhausted, or
 * a non-429 HTTP error): a partial sum is not a 24 h volume, and the caller
 * persists "unknown" rather than an understated figure (PRE2 A3).
 *
 * Also returns null, with one warning naming the variable, when the configured
 * base is not an absolute URL (PRE3): before, `new URL` threw out of the walk,
 * the step died before writing any metric row, and Node's error carried the
 * raw URL — key included — into the cron log. An empty value counts as unset.
 */
export async function fetchPoolTrades(
  params: {
    poolId: string;
    feeBp: number;
    xlmUsd: number | null;
  },
  fetchPage: TradesPageFetcher = (url) => fetchJson<HorizonTradesResponse>(url)
): Promise<PoolTradeMetrics | null> {
  const { poolId, feeBp, xlmUsd } = params;

  const tradesBaseUrl = resolveTradesBaseUrl();

  console.log(
    `[stellar-native] pool=${poolId} trades via ${maskRpcUrl(tradesBaseUrl)}`
  );

  // `new URL("/liquidity_pools/...", base)` would drop the provider's
  // `/v1/<key>` prefix — build the URL by concatenation instead.
  let first: URL;

  try {
    first = new URL(
      `${tradesBaseUrl.replace(/\/$/, "")}/liquidity_pools/${poolId}/trades`
    );
  } catch {
    console.warn(
      `[stellar-native] HORIZON_TRADES_URL / HORIZON_URL is not an absolute URL (host ${maskRpcUrl(
        tradesBaseUrl
      )}) — volume24h unknown for pool ${poolId} this run`
    );
    return null;
  }

  first.searchParams.set("order", "desc");
  first.searchParams.set("limit", String(PAGE_LIMIT));

  const cutoff = Date.now() - WINDOW_MS;

  let volume24hUsd = 0;
  let trades24h = 0;

  let nextUrl: string | null = first.toString();

  for (let page = 0; page < MAX_PAGES && nextUrl; page++) {
    let json: HorizonTradesResponse;

    console.log(
      `[stellar-native] page=${page} url=${maskHorizonUrl(nextUrl)}`
    );

    try {
      json = await fetchPage(nextUrl);
    } catch (err) {
      // One warning, pool + page named; the partial sum is dropped.
      console.warn(
        `[stellar-native] trades page ${page} failed for pool ${poolId}: ${
          err instanceof Error ? err.message : String(err)
        } — volume24h unknown for this run (partial sum ${volume24hUsd.toFixed(2)} discarded)`
      );
      return null;
    }

    const records = json?._embedded?.records ?? [];

    console.log(
      `[stellar-native] page=${page} records=${records.length}`
    );

    if (records.length === 0) {
      break;
    }

    let reachedOld = false;

    for (const trade of records) {
      const t = Date.parse(trade.ledger_close_time);

      if (Number.isFinite(t) && t < cutoff) {
        reachedOld = true;
        break;
      }

      trades24h += 1;

      const usd = tradeUsd(trade, xlmUsd);

      if (usd !== null && Number.isFinite(usd)) {
        volume24hUsd += usd;
      }
    }

    if (reachedOld) {
      break;
    }

    nextUrl = json?._links?.next?.href ?? null;
  }

  const fees24hUsd = volume24hUsd * (feeBp / 10000);

  console.log(
    `[stellar-native] pool=${poolId} trades24h=${trades24h} volume24hUsd=${volume24hUsd.toFixed(
      2
    )} fees24hUsd=${fees24hUsd.toFixed(2)}`
  );

  return {
    volume24hUsd,
    fees24hUsd,
    trades24h,
  };
}
