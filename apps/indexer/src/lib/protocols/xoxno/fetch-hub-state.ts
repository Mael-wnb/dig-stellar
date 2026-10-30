// apps/indexer/src/lib/protocols/xoxno/fetch-hub-state.ts
//
// Pure on-chain fetch of one XOXNO hub: read-only `simulateTransaction` calls
// through the configured RPC (resolveRpcUrl), strictly sequential via the shared
// SorobanReader. No HTTP API of XOXNO is ever called on this path.
//
// Per market (HubAssetKey { asset, hub_id }) the pool VIEWS are read — never the
// raw `State` ledger entry, which only moves on interaction and lags accrual:
//   get_sync_data        → params (asset_decimals, interest-rate model, reserve
//                          factor) — STATIC: read at most once per 24 h through
//                          the entity-metadata paramsCache (see types.ts)
//   get_reserves         → cash (the TVL leg; what DefiLlama sums)
//   get_supplied_amount  → total supplied, accrued to now
//   get_borrowed_amount  → total borrowed, accrued to now
//   get_utilisation      → RAY fraction
//   get_deposit_rate     → RAY APR
//   get_borrow_rate      → RAY APR
// plus controller.get_market_indexes_detailed (chunks of 3) for the aggregator
// price + stale/valid flags — ONLY for the markets eligible for the scoped
// pricing fallback (pricing-scope.ts); own-priced markets are never sent.
//
// Steady-state cost per refresh: 6 simulations per market + 1 per 3 fallback
// keys + 1 app-version read (+ 1 account read) per hub.
//
// Every return value is decoded by XDR type here (i128 → BigInt, structs by their
// symbol keys), not through scValToNative, so struct-keyed maps and 18-decimal
// amounts never lose information before the final conversion.
import { Address, xdr } from '@stellar/stellar-sdk';
import { resolveRpcUrl } from '../../rpc-config';
import { scalePrice } from '../../../scripts/shared/reflector';
import { SorobanReader, type RawReadResult } from '../../../scripts/shared/soroban-read';
import {
  RAY_DECIMALS,
  WAD_DECIMALS,
  XOXNO_CONTROLLER_CONTRACT,
  XOXNO_EXPECTED_APP_VERSION,
  XOXNO_PARAMS_MAX_AGE_SEC,
  XOXNO_POOL_CONTRACT,
  XOXNO_PRICE_CHUNK_SIZE,
  XOXNO_READ_SPACING_MS,
  XOXNO_VENUE_SLUG,
  type XoxnoAggregatorPrice,
  type XoxnoHubState,
  type XoxnoInterestRateModel,
  type XoxnoMarketParams,
  type XoxnoMarketSeed,
  type XoxnoMarketState,
  type XoxnoParamsCache,
} from './types';

// ── ScVal encoding / decoding ─────────────────────────────────────────────────

/** HubAssetKey { hub_id: u32, asset: Address } as a Soroban struct: a map whose
 *  symbol keys MUST be sorted ("asset" < "hub_id") or the host rejects it. */
export function hubAssetKeyScVal(hubId: number, asset: string): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('asset'), val: new Address(asset).toScVal() }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('hub_id'), val: xdr.ScVal.scvU32(hubId) }),
  ]);
}

const TWO_64 = 1n << 64n;

/** i128 / u128 / i64 / u64 / u32 / i32 → BigInt, exact. */
export function scvToBigInt(v: xdr.ScVal): bigint {
  switch (v.switch().name) {
    case 'scvI128': {
      const p = v.i128();
      return BigInt(p.hi().toString()) * TWO_64 + BigInt(p.lo().toString());
    }
    case 'scvU128': {
      const p = v.u128();
      return BigInt(p.hi().toString()) * TWO_64 + BigInt(p.lo().toString());
    }
    case 'scvI64':
      return BigInt(v.i64().toString());
    case 'scvU64':
      return BigInt(v.u64().toString());
    case 'scvU32':
      return BigInt(v.u32());
    case 'scvI32':
      return BigInt(v.i32());
    case 'scvTimepoint':
      return BigInt(v.timepoint().toString());
    default:
      throw new Error(`scvToBigInt: unexpected ScVal ${v.switch().name}`);
  }
}

export function scvToNumber(v: xdr.ScVal): number {
  const n = scvToBigInt(v);
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`scvToNumber: ${n} exceeds the safe integer range`);
  }
  return Number(n);
}

export function scvToBool(v: xdr.ScVal): boolean {
  if (v.switch().name !== 'scvBool') throw new Error(`scvToBool: unexpected ScVal ${v.switch().name}`);
  return v.b();
}

export function scvToAddress(v: xdr.ScVal): string {
  if (v.switch().name !== 'scvAddress') throw new Error(`scvToAddress: unexpected ScVal ${v.switch().name}`);
  return Address.fromScVal(v).toString();
}

/** A #[contracttype] struct comes back as a map with Symbol keys. */
export function scvStruct(v: xdr.ScVal): Record<string, xdr.ScVal> {
  if (v.switch().name !== 'scvMap') throw new Error(`scvStruct: unexpected ScVal ${v.switch().name}`);
  const out: Record<string, xdr.ScVal> = {};
  for (const entry of v.map() ?? []) {
    const key = entry.key();
    if (key.switch().name !== 'scvSymbol') throw new Error(`scvStruct: non-symbol key ${key.switch().name}`);
    out[key.sym().toString()] = entry.val();
  }
  return out;
}

export function scvVec(v: xdr.ScVal): xdr.ScVal[] {
  if (v.switch().name !== 'scvVec') throw new Error(`scvVec: unexpected ScVal ${v.switch().name}`);
  return v.vec() ?? [];
}

/** Option<T>: Void → null. */
export function scvOption(v: xdr.ScVal): xdr.ScVal | null {
  return v.switch().name === 'scvVoid' ? null : v;
}

function field(struct: Record<string, xdr.ScVal>, name: string, where: string): xdr.ScVal {
  const v = struct[name];
  if (!v) throw new Error(`${where}: missing field "${name}" (got ${Object.keys(struct).join(',')})`);
  return v;
}

// ── Fixed-point conversions (exact split, see shared/reflector scalePrice) ────

export const scaleFixed = (raw: bigint, decimals: number): number => scalePrice(raw, decimals);
export const rayToFraction = (ray: bigint): number => scalePrice(ray, RAY_DECIMALS);
export const wadToNumber = (wad: bigint): number => scalePrice(wad, WAD_DECIMALS);

/** Continuous compounding of the on-chain APR; matches the APY XOXNO publishes
 *  (e.g. USDC borrow 2.6702 % APR → 2.706 % APY at recon time). */
export const aprToApy = (apr: number): number => Math.exp(apr) - 1;

// ── Reads ────────────────────────────────────────────────────────────────────

function unwrap(res: RawReadResult, what: string): xdr.ScVal {
  if (!res.ok) throw new Error(`${what}: ${res.kind}: ${res.error}`);
  if (!res.retval) throw new Error(`${what}: empty return value`);
  return res.retval;
}

function decodeInterestRateModel(params: Record<string, xdr.ScVal>): XoxnoInterestRateModel {
  const where = 'MarketParamsRaw';
  return {
    baseBorrowRate: rayToFraction(scvToBigInt(field(params, 'base_borrow_rate', where))),
    slope1: rayToFraction(scvToBigInt(field(params, 'slope1', where))),
    slope2: rayToFraction(scvToBigInt(field(params, 'slope2', where))),
    slope3: rayToFraction(scvToBigInt(field(params, 'slope3', where))),
    optimalUtilization: rayToFraction(scvToBigInt(field(params, 'optimal_utilization', where))),
    midUtilization: rayToFraction(scvToBigInt(field(params, 'mid_utilization', where))),
    maxUtilization: rayToFraction(scvToBigInt(field(params, 'max_utilization', where))),
    maxBorrowRate: rayToFraction(scvToBigInt(field(params, 'max_borrow_rate', where))),
    reserveFactorBps: scvToNumber(field(params, 'reserve_factor', where)),
    flashloanFeeBps: scvToNumber(field(params, 'flashloan_fee', where)),
    isFlashloanable: scvToBool(field(params, 'is_flashloanable', where)),
  };
}

/** MarketIndexView → aggregator price; `null` when the entry is unreadable. */
function decodeMarketIndexView(v: xdr.ScVal, now: Date): XoxnoAggregatorPrice {
  const s = scvStruct(v);
  const where = 'MarketIndexView';
  const ts = scvToNumber(field(s, 'price_timestamp', where));
  const err = scvOption(field(s, 'error_code', where));
  return {
    priceUsd: wadToNumber(scvToBigInt(field(s, 'price_wad', where))),
    primaryPriceUsd: wadToNumber(scvToBigInt(field(s, 'primary_price_wad', where))),
    anchorPriceUsd: wadToNumber(scvToBigInt(field(s, 'anchor_price_wad', where))),
    priceTimestamp: ts,
    ageSec: Math.round(now.getTime() / 1000 - ts),
    stale: scvToBool(field(s, 'stale', where)),
    valid: scvToBool(field(s, 'valid', where)),
    deviation: scvToBool(field(s, 'deviation', where)),
    errorCode: err ? scvToNumber(err) : null,
  };
}

// ── Static params cache ──────────────────────────────────────────────────────

/** Pure: whether a persisted paramsCache may serve this run. Hub-wide: age
 *  (fetchedAt within maxAgeSec of `now`) and the controller app version. A
 *  seeded market missing from `byAsset` is simply read from chain (new market). */
export function isParamsCacheUsable(
  cache: XoxnoParamsCache | null | undefined,
  now: Date,
  appVersion: number,
  maxAgeSec = XOXNO_PARAMS_MAX_AGE_SEC
): boolean {
  if (!cache || typeof cache.fetchedAt !== 'string' || !cache.byAsset || typeof cache.byAsset !== 'object') return false;
  if (cache.appVersion !== appVersion) return false;
  const fetchedAt = Date.parse(cache.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return false;
  const ageSec = (now.getTime() - fetchedAt) / 1000;
  return ageSec >= 0 && ageSec <= maxAgeSec;
}

function isMarketParams(v: unknown): v is XoxnoMarketParams {
  const p = v as XoxnoMarketParams | null;
  return (
    !!p &&
    typeof p.decimals === 'number' &&
    Number.isInteger(p.decimals) &&
    !!p.interestRateModel &&
    typeof p.interestRateModel.reserveFactorBps === 'number'
  );
}

export async function readAppVersion(reader: SorobanReader, controller = XOXNO_CONTROLLER_CONTRACT): Promise<number> {
  return scvToNumber(unwrap(await reader.readRaw(controller, 'get_app_version'), 'controller.get_app_version'));
}

export async function fetchXoxnoHubState(params: {
  entitySlug: string;
  hubId: number;
  hubName: string;
  markets: XoxnoMarketSeed[];
  sourceAccount: string;
  /** Asset contract ids eligible for the aggregator price fallback (pricing-scope.ts).
   *  Only these are sent to get_market_indexes_detailed. */
  priceFallbackAssets: ReadonlySet<string>;
  /** The persisted static-params cache (entity metadata), if any. */
  paramsCache?: XoxnoParamsCache | null;
  /** Ignore the cache and re-read every market's params from chain. */
  forceParamsRefresh?: boolean;
  paramsMaxAgeSec?: number;
  rpcUrl?: string;
  poolContract?: string;
  controllerContract?: string;
  expectedAppVersion?: number;
  verbose?: boolean;
}): Promise<XoxnoHubState> {
  const {
    entitySlug,
    hubId,
    hubName,
    markets,
    sourceAccount,
    priceFallbackAssets,
    paramsCache = null,
    forceParamsRefresh = false,
    paramsMaxAgeSec = XOXNO_PARAMS_MAX_AGE_SEC,
    poolContract = XOXNO_POOL_CONTRACT,
    controllerContract = XOXNO_CONTROLLER_CONTRACT,
    expectedAppVersion = XOXNO_EXPECTED_APP_VERSION,
    verbose = false,
  } = params;

  if (!sourceAccount) throw new Error('fetchXoxnoHubState: sourceAccount is required (STELLAR_SOURCE_ACCOUNT)');
  if (!markets.length) throw new Error(`fetchXoxnoHubState: hub ${hubId} has no seeded markets`);

  const rpcUrl = resolveRpcUrl(params.rpcUrl);
  const reader = new SorobanReader({ rpcUrl, sourceAccount, spacingMs: XOXNO_READ_SPACING_MS });
  const now = new Date();
  let latestLedger: number | null = null;
  const note = (res: RawReadResult) => {
    if (res.ok && res.latestLedger !== null) latestLedger = res.latestLedger;
    return res;
  };

  // Smoke check: the controller's app version. A change means the views we
  // read may have new semantics → fail THIS step loudly (71 isolates it).
  const appVersion = await readAppVersion(reader, controllerContract);
  if (appVersion !== expectedAppVersion) {
    const banner = '!'.repeat(72);
    console.error(
      `\n${banner}\n[xoxno] controller.get_app_version() = ${appVersion}, expected ${expectedAppVersion}.\n` +
        `[xoxno] The XOXNO controller was upgraded; the pool/controller views this adapter relies on\n` +
        `[xoxno] may have changed. Refusing to refresh hub ${hubId} (${entitySlug}) until the spec is\n` +
        `[xoxno] re-verified and XOXNO_EXPECTED_APP_VERSION is bumped (docs/runbooks.md § XOXNO).\n${banner}\n`
    );
    throw new Error(`xoxno app_version changed: ${appVersion} (expected ${expectedAppVersion})`);
  }

  const states: XoxnoMarketState[] = [];

  // Static params: serve from the persisted cache when it is fresh and was read
  // under the same app version; read from chain otherwise (and for any seeded
  // market the cache does not know — a newly added market needs no manual step).
  const cacheUsable = !forceParamsRefresh && isParamsCacheUsable(paramsCache, now, appVersion, paramsMaxAgeSec);
  const nextByAsset: Record<string, XoxnoMarketParams> = {};
  let paramsFromCache = 0;
  let paramsFromChain = 0;

  for (const market of markets) {
    const key = hubAssetKeyScVal(hubId, market.asset);
    const tag = `${market.symbol} (hub ${hubId})`;

    const cached = cacheUsable ? paramsCache!.byAsset[market.asset] : undefined;
    let marketParams: XoxnoMarketParams;
    let paramsSource: XoxnoMarketState['paramsSource'];
    if (isMarketParams(cached)) {
      marketParams = cached;
      paramsSource = 'cache';
      paramsFromCache += 1;
    } else {
      const sync = scvStruct(unwrap(note(await reader.readRaw(poolContract, 'get_sync_data', [key])), `pool.get_sync_data ${tag}`));
      const paramsStruct = scvStruct(field(sync, 'params', 'PoolSyncData'));
      const onChainAsset = scvToAddress(field(paramsStruct, 'asset_id', 'MarketParamsRaw'));
      if (onChainAsset !== market.asset) {
        throw new Error(`pool.get_sync_data ${tag}: asset_id ${onChainAsset} does not match the seeded ${market.asset}`);
      }
      marketParams = {
        decimals: scvToNumber(field(paramsStruct, 'asset_decimals', 'MarketParamsRaw')),
        interestRateModel: decodeInterestRateModel(paramsStruct),
      };
      paramsSource = 'chain';
      paramsFromChain += 1;
    }
    nextByAsset[market.asset] = marketParams;
    const { decimals } = marketParams;

    const cashRaw = scvToBigInt(unwrap(note(await reader.readRaw(poolContract, 'get_reserves', [key])), `pool.get_reserves ${tag}`));
    const suppliedRaw = scvToBigInt(unwrap(note(await reader.readRaw(poolContract, 'get_supplied_amount', [key])), `pool.get_supplied_amount ${tag}`));
    const borrowedRaw = scvToBigInt(unwrap(note(await reader.readRaw(poolContract, 'get_borrowed_amount', [key])), `pool.get_borrowed_amount ${tag}`));
    const utilisationRay = scvToBigInt(unwrap(note(await reader.readRaw(poolContract, 'get_utilisation', [key])), `pool.get_utilisation ${tag}`));
    const depositRateRay = scvToBigInt(unwrap(note(await reader.readRaw(poolContract, 'get_deposit_rate', [key])), `pool.get_deposit_rate ${tag}`));
    const borrowRateRay = scvToBigInt(unwrap(note(await reader.readRaw(poolContract, 'get_borrow_rate', [key])), `pool.get_borrow_rate ${tag}`));

    const depositApr = rayToFraction(depositRateRay);
    const borrowApr = rayToFraction(borrowRateRay);

    states.push({
      asset: market.asset,
      symbol: market.symbol,
      name: market.name,
      decimals,
      cashRaw,
      suppliedRaw,
      borrowedRaw,
      cash: scaleFixed(cashRaw, decimals),
      supplied: scaleFixed(suppliedRaw, decimals),
      borrowed: scaleFixed(borrowedRaw, decimals),
      utilisation: rayToFraction(utilisationRay),
      depositApr,
      borrowApr,
      estSupplyApy: aprToApy(depositApr),
      estBorrowApy: aprToApy(borrowApr),
      interestRateModel: marketParams.interestRateModel,
      paramsSource,
      aggregatorPrice: null,
    });

    if (verbose) {
      console.log(`[xoxno] ${tag}: cash=${cashRaw} supplied=${suppliedRaw} borrowed=${borrowedRaw} dec=${decimals} util=${rayToFraction(utilisationRay)} params=${paramsSource}`);
    }
  }

  // The cache to persist: entries for the seeded markets only (a de-listed
  // market drops out). fetchedAt moves forward only when EVERY entry was just
  // read from chain, so a hub-wide re-read still happens at the original expiry.
  const nextParamsCache: XoxnoParamsCache = {
    fetchedAt: paramsFromCache === 0 ? now.toISOString() : paramsCache!.fetchedAt,
    appVersion,
    byAsset: nextByAsset,
  };

  // Aggregator prices, ONLY for the fallback-eligible markets, in small chunks
  // (budget limit). A failed chunk leaves its markets without an aggregator
  // price (fallback absent) — never fails the hub.
  const fallbackStates = states.filter((m) => priceFallbackAssets.has(m.asset));
  let priceChunks = 0;
  for (let i = 0; i < fallbackStates.length; i += XOXNO_PRICE_CHUNK_SIZE) {
    const chunk = fallbackStates.slice(i, i + XOXNO_PRICE_CHUNK_SIZE);
    priceChunks += 1;
    const keys = xdr.ScVal.scvVec(chunk.map((m) => hubAssetKeyScVal(hubId, m.asset)));
    const res = note(await reader.readRaw(controllerContract, 'get_market_indexes_detailed', [keys]));
    if (!res.ok || !res.retval) {
      console.warn(`[xoxno] controller.get_market_indexes_detailed (hub ${hubId}, ${chunk.map((m) => m.symbol).join(',')}) unreadable: ${res.ok ? 'empty' : res.error} — no aggregator price this run`);
      continue;
    }
    const views = scvVec(res.retval);
    if (views.length !== chunk.length) {
      console.warn(`[xoxno] get_market_indexes_detailed returned ${views.length} entries for ${chunk.length} keys — ignored`);
      continue;
    }
    views.forEach((v, j) => {
      try {
        const view = scvStruct(v);
        const viewAsset = scvToAddress(field(view, 'asset', 'MarketIndexView'));
        if (viewAsset !== chunk[j].asset) throw new Error(`asset mismatch ${viewAsset} vs ${chunk[j].asset}`);
        chunk[j].aggregatorPrice = decodeMarketIndexView(v, now);
      } catch (error) {
        console.warn(`[xoxno] MarketIndexView for ${chunk[j].symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  return {
    venueSlug: XOXNO_VENUE_SLUG,
    entityType: 'lending_pool',
    entitySlug,
    hubId,
    hubName,
    poolContract,
    controllerContract,
    appVersion,
    latestLedger,
    markets: states,
    paramsCache: nextParamsCache,
    callPlan: { paramsFromCache, paramsFromChain, priceFallbackKeys: fallbackStates.length, priceChunks },
    readStats: { ...reader.stats },
  };
}
