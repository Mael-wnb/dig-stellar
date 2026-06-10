// apps/indexer/src/lib/protocols/stellar-native/fetch-pool-trades.ts
import "dotenv/config";
import { fetchJson, getEnv } from "../../../scripts/discovery/00-common";

// Classic SDEX liquidity pools (via Horizon) don't expose 24h volume/fees on the
// pool record. We derive them from the pool's trade history:
//   GET /liquidity_pools/<id>/trades?order=desc
// Each trade has a base leg and a counter leg of equal value, so valuing ONE leg
// whose USD price we know is enough. Fees = volume * fee_bp / 10000.

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

// Stable-asset USD prices we treat as known constants. XLM is priced from the DB.
const STABLE_USD: Record<string, number> = {
  USDC: 1,
  EURC: 1.16,
};

const WINDOW_MS = 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 200; // Horizon max page size
const MAX_PAGES = 25; // safety cap (~5000 trades) so a hot pool can't run away

// USD unit price for one trade leg, or null when we don't know it.
function legUnitUsd(
  assetType: string,
  assetCode: string | undefined,
  xlmUsd: number | null
): number | null {
  if (assetType === "native") return xlmUsd;
  if (assetCode && assetCode in STABLE_USD) return STABLE_USD[assetCode];
  return null;
}

// USD value of a single trade: value whichever leg has a known price.
function tradeUsd(trade: HorizonTrade, xlmUsd: number | null): number | null {
  const baseUnit = legUnitUsd(
    trade.base_asset_type,
    trade.base_asset_code,
    xlmUsd
  );
  if (baseUnit !== null) return Number(trade.base_amount) * baseUnit;

  const counterUnit = legUnitUsd(
    trade.counter_asset_type,
    trade.counter_asset_code,
    xlmUsd
  );
  if (counterUnit !== null) return Number(trade.counter_amount) * counterUnit;

  return null;
}

export async function fetchPoolTrades(params: {
  poolId: string;
  feeBp: number;
  xlmUsd: number | null;
}): Promise<PoolTradeMetrics> {
  const { poolId, feeBp, xlmUsd } = params;
  const horizonUrl = getEnv("HORIZON_URL", "https://horizon.stellar.org");
  const cutoff = Date.now() - WINDOW_MS;

  let volume24hUsd = 0;
  let trades24h = 0;

  const first = new URL(`/liquidity_pools/${poolId}/trades`, horizonUrl);
  first.searchParams.set("order", "desc");
  first.searchParams.set("limit", String(PAGE_LIMIT));
  let nextUrl: string | null = first.toString();

  for (let page = 0; page < MAX_PAGES && nextUrl; page++) {
    let json: HorizonTradesResponse;
    try {
      json = await fetchJson<HorizonTradesResponse>(nextUrl);
    } catch (err) {
      // A failed /trades page must not crash the refresh — keep what we have.
      console.warn(
        `[stellar-native] trades fetch failed for pool ${poolId}: ${
          err instanceof Error ? err.message : String(err)
        } — using partial (volume so far=${volume24hUsd})`
      );
      break;
    }

    const records = json?._embedded?.records ?? [];
    if (records.length === 0) break;

    let reachedOld = false;
    for (const trade of records) {
      const t = Date.parse(trade.ledger_close_time);
      if (Number.isFinite(t) && t < cutoff) {
        reachedOld = true; // desc order → everything after is older too
        break;
      }
      trades24h += 1;
      const usd = tradeUsd(trade, xlmUsd);
      if (usd !== null && Number.isFinite(usd)) {
        volume24hUsd += usd;
      }
    }

    if (reachedOld) break;
    nextUrl = json?._links?.next?.href ?? null;
  }

  const fees24hUsd = volume24hUsd * (feeBp / 10000);

  return { volume24hUsd, fees24hUsd, trades24h };
}
