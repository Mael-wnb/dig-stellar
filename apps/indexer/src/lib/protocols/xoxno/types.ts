// apps/indexer/src/lib/protocols/xoxno/types.ts
//
// XOXNO Lending (Lot XO, XO-1: read-only market analytics).
//
// Architecture (derived from the on-chain WASM spec + simulations, step-0 recon
// 2026-10-26 — never from the XOXNO/rs-lending-xlm repository, whose PolyForm
// Noncommercial licence we respect by reading contracts on-chain only):
//   Controller  — accounts / risk / price views
//   Pool        — ONE central contract: custody + per-market accounting
//   Position NFT — one NFT = one account (XO-2, out of scope here)
//   Price aggregator — Reflector / RedStone / XOXNO feeds + Aquarius LP pricers
// A market is a HubAssetKey { hub_id: u32, asset: Address }. We model one entity
// per HUB (Blend pattern: entity = pool, reserve row = market).
//
// Units: rates are RAY (1e27) APR, USD / health are WAD (1e18), amounts are raw
// token units with MarketParamsRaw.asset_decimals (7, 9 and 18 all exist).

export const XOXNO_VENUE_SLUG = 'xoxno';
// Venue display name: 'XOXNO' (the product UI adds the type label, e.g.
// "Lending, 3 pools" — the longer 'XOXNO Lending' wrapped in the venue tiles).
export const XOXNO_VENUE_NAME = 'XOXNO';

export const XOXNO_POOL_CONTRACT = 'CBXRNDQMAJFG4VUKMKFEMFS75UUXE2SPSNV4LEEFCSNBCN66PYRWBKXO';
export const XOXNO_CONTROLLER_CONTRACT = 'CAUCMIN5KSXEVZ7NMXR3LZATGD5EFIEUI5XWTFLYRO2R5OTXI22WE5JX';
export const XOXNO_POSITION_NFT_CONTRACT = 'CAWCSG77AY2W24QZ6ZXLHZU4UXEFHZBM6EI4A4IF7JB5CTY4XND3TI6C';
export const XOXNO_PRICE_AGGREGATOR_CONTRACT = 'CBGUF2G2Q7HCVCWYISDXBHPVBGMYNXA7PG2VET66YBZX6IKOOV27NSMV';

// controller.get_app_version() at recon time. The refresh reads it at the start
// of every run and FAILS the xoxno step (loudly) when it differs — an upgraded
// controller may have changed the view semantics we rely on.
export const XOXNO_EXPECTED_APP_VERSION = 1;

export const RAY_DECIMALS = 27;
export const WAD_DECIMALS = 18;

// asset_prices.source written by the scoped fallback (decision note
// docs/decisions/2026-10-27-xoxno-tvl-and-pricing.md). Readers that must prefer
// our own sources order this source LAST.
export const XOXNO_AGGREGATOR_PRICE_SOURCE = 'xoxno-aggregator';

// Our OWN max age on the fallback, on top of the aggregator's stale/valid flags
// (which tolerate long ages for RWA / stable feeds: 7.8 h observed at recon time).
// Older → the market is unpriced (excluded from TVL, counted in unpricedMarkets).
export const XOXNO_AGGREGATOR_MAX_AGE_SEC = 24 * 60 * 60;

// get_market_indexes_detailed exceeds the simulation budget above a few keys
// (25 keys → Budget ExceededLimit at recon time; 3 keys → ok in ~120 ms).
export const XOXNO_PRICE_CHUNK_SIZE = 3;

// Minimum gap between two XOXNO simulations: 4 req/s, under the 5 req/s the
// public endpoint tolerates (local runs) and far below what a paid endpoint
// allows. ~160 calls per refresh → ~40 s, well inside the 15-minute cadence.
export const XOXNO_READ_SPACING_MS = 250;

// Static market params (asset_decimals, interest-rate model, reserve factor —
// pool.get_sync_data) change only through a governance params update. They are
// cached in the hub entity's metadata (paramsCache, DB-backed, no new infra)
// and re-read from chain at most once per 24 h, or earlier when the cache is
// missing a seeded market, the controller app version changed, or
// XOXNO_PARAMS_REFRESH=1 is set. Saves one simulation per market per refresh.
export const XOXNO_PARAMS_MAX_AGE_SEC = 24 * 60 * 60;

/** One seeded market (hub entity metadata + bootstrap). Decimals are the seed-time
 *  value; the refresh takes them from MarketParamsRaw (chain read or the 24 h
 *  paramsCache), never from the seed. */
export type XoxnoMarketSeed = {
  asset: string;
  symbol: string;
  name: string;
  decimals: number;
};

/** entities.metadata for a hub entity (written by the bootstrap, merged on refresh). */
export type XoxnoHubEntityMetadata = {
  source: string;
  hubId: number;
  hubName: string;
  pool: string;
  controller: string;
  positionNft: string;
  priceAggregator: string;
  markets: XoxnoMarketSeed[];
  provenance?: Record<string, unknown>;
  /** Static params per market, re-read at most every XOXNO_PARAMS_MAX_AGE_SEC. */
  paramsCache?: XoxnoParamsCache;
  // refreshed on every run
  appVersion?: number;
  latestLedger?: number | null;
  reserveCount?: number;
  lastRefreshAt?: string;
};

export type XoxnoInterestRateModel = {
  baseBorrowRate: number;
  slope1: number;
  slope2: number;
  slope3: number;
  optimalUtilization: number;
  midUtilization: number;
  maxUtilization: number;
  maxBorrowRate: number;
  reserveFactorBps: number;
  flashloanFeeBps: number;
  isFlashloanable: boolean;
};

/** Static params of one market, as decoded from MarketParamsRaw (get_sync_data). */
export type XoxnoMarketParams = {
  decimals: number;
  interestRateModel: XoxnoInterestRateModel;
};

/** DB-backed cache of the static params of a hub's markets (entity metadata). */
export type XoxnoParamsCache = {
  /** When the cached entries were read from chain (ISO). Hub-wide expiry key. */
  fetchedAt: string;
  /** controller.get_app_version() at fetch time; a change invalidates the cache. */
  appVersion: number;
  /** Keyed by market asset contract id. */
  byAsset: Record<string, XoxnoMarketParams>;
};

/** Per-run read plan, kept in pool_snapshots.metadata for the ops evidence. */
export type XoxnoCallPlan = {
  paramsFromCache: number;
  paramsFromChain: number;
  priceFallbackKeys: number;
  priceChunks: number;
};

/** controller.get_market_indexes_detailed entry, scaled. */
export type XoxnoAggregatorPrice = {
  priceUsd: number;
  primaryPriceUsd: number;
  anchorPriceUsd: number;
  priceTimestamp: number; // unix seconds
  ageSec: number;
  stale: boolean;
  valid: boolean;
  deviation: boolean;
  errorCode: number | null;
};

export type XoxnoMarketState = {
  asset: string;
  symbol: string;
  name: string;
  decimals: number; // from MarketParamsRaw.asset_decimals (on-chain)
  // raw i128 token units, kept as BigInt until the final conversion
  cashRaw: bigint; // pool.get_reserves — the TVL leg (DefiLlama-consistent)
  suppliedRaw: bigint; // pool.get_supplied_amount (accrued to now)
  borrowedRaw: bigint; // pool.get_borrowed_amount (accrued to now)
  // decimal conversions (exact integer/fraction split, see scaleFixed)
  cash: number;
  supplied: number;
  borrowed: number;
  utilisation: number; // RAY → fraction
  depositApr: number; // RAY → fraction (APR)
  borrowApr: number; // RAY → fraction (APR)
  estSupplyApy: number; // exp(apr) - 1
  estBorrowApy: number; // exp(apr) - 1
  interestRateModel: XoxnoInterestRateModel;
  paramsSource: 'chain' | 'cache';
  /** null when the market is own-priced (never read from the aggregator) or the read failed. */
  aggregatorPrice: XoxnoAggregatorPrice | null;
};

export type XoxnoHubState = {
  venueSlug: typeof XOXNO_VENUE_SLUG;
  entityType: 'lending_pool';
  entitySlug: string;
  hubId: number;
  hubName: string;
  poolContract: string;
  controllerContract: string;
  appVersion: number;
  latestLedger: number | null;
  markets: XoxnoMarketState[];
  /** The cache to persist back into the entity metadata (refreshed or carried over). */
  paramsCache: XoxnoParamsCache;
  callPlan: XoxnoCallPlan;
  readStats: { calls: number; retries: number; failures: number };
};

export type XoxnoHubMetrics = {
  tvlUsd: number | null; // Σ cash × price over PRICED markets; null when none priced
  totalSuppliedUsd: number;
  totalBorrowedUsd: number;
  netLiquidityUsd: number | null;
  weightedSupplyApy: number | null;
  weightedBorrowApy: number | null;
  pricedMarkets: number;
  totalMarkets: number;
  unpricedMarkets: string[];
  reserveBreakdown: Array<{
    assetId: string;
    asset: string | null;
    symbol: string | null;
    priceUsd: number | null;
    priceSource: string | null;
    cash: number;
    cashUsd: number | null;
    supplied: number;
    suppliedUsd: number | null;
    borrowed: number;
    borrowedUsd: number | null;
    utilisation: number | null;
    supplyApr: number | null;
    supplyApy: number | null;
    borrowApr: number | null;
    borrowApy: number | null;
  }>;
};
