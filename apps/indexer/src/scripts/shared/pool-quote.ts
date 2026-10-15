// apps/indexer/src/scripts/shared/pool-quote.ts
//
// Simulated pool quote — the `pool_quote` price source (price-sources v2, phase B).
// Every Aquarius pool type exposes the same read-only estimator (WASM spec read
// on-chain, 05-phase-b-design.md §3):
//   estimate_swap(in_idx: u32, out_idx: u32, in_amount: u128) -> u128   (fee included)
//   get_reserves() -> Vec<u128>, get_fee_fraction() -> u32 (bps), get_tokens() -> Vec<Address>
//   concentrated only: get_slot0() -> { sqrt_price_x96: u256, tick: i32 }, get_active_liquidity() -> u128
//
// Method per pool type:
//   - StableSwap: estimate_swap in BOTH directions at a small size; the mid price is
//     the geometric mean of the two directional quotes, so the symmetric fee cancels
//     and no rounding bites at ≥ 0.1 token. The reserve RATIO is not a price on these
//     pools (USDGLO/USDC sits at 1.12 for a $1 coin); the quote is.
//   - Concentrated: `get_slot0().sqrt_price_x96` is the exact marginal price with no
//     swap and no rounding (the buy-side estimate rounds to 0 below ~0.1 USDC).
//   - Constant product: the reserve ratio already IS the marginal price (A1) — no quote.
// Depth guard: the quote-side reserve ≥ XLM_ONCHAIN_MIN_USDC_RESERVE (50 000 USD), the
// same floor as the cp candidates; a thin pool is a cross-check, never a primary.
import type { SorobanReader } from './soroban-read';
import { scU128, scU32 } from './soroban-read';
import { XLM_ONCHAIN_MIN_USDC_RESERVE } from './xlm-price';

export const POOL_QUOTE_MIN_QUOTE_USD = XLM_ONCHAIN_MIN_USDC_RESERVE;

/** 0.1 token in base units — far below any perimeter pool's depth, above rounding. */
export function stableQuoteSizeUnits(decimals: number): bigint {
  return 10n ** BigInt(Math.max(decimals - 1, 0));
}

/**
 * Mid price of token0 expressed in token1 from two directional `estimate_swap`
 * quotes (amounts in base units): sqrt((out01/in01) × (in10/out10)). Returns null
 * when either leg is zero / non-finite (rounding at a size too small).
 */
export function stableMidPrice(params: {
  in01: bigint; // token0 sent
  out01: bigint; // token1 received
  in10: bigint; // token1 sent
  out10: bigint; // token0 received
  dec0: number;
  dec1: number;
}): number | null {
  const { in01, out01, in10, out10, dec0, dec1 } = params;
  if (in01 <= 0n || out01 <= 0n || in10 <= 0n || out10 <= 0n) return null;
  const scale = 10 ** (dec0 - dec1);
  const sell = (Number(out01) / Number(in01)) * scale; // token1 per token0, fee taken on the way out
  const buy = (Number(in10) / Number(out10)) * scale; // token1 per token0, fee taken on the way in
  const mid = Math.sqrt(sell * buy);
  return Number.isFinite(mid) && mid > 0 ? mid : null;
}

/** token1 per token0 from a Uniswap-v3-style sqrt price (Q64.96), decimals adjusted. */
export function slot0Price(sqrtPriceX96: bigint, dec0: number, dec1: number): number | null {
  if (sqrtPriceX96 <= 0n) return null;
  const sqrt = Number(sqrtPriceX96) / 2 ** 96;
  const price = sqrt * sqrt * 10 ** (dec0 - dec1);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export type PoolQuote = {
  /** quote token units per 1 asset token */
  priceInQuote: number;
  /** human reserves [asset, quote] */
  assetReserve: number;
  quoteReserve: number;
  feeBps: number | null;
  method: 'stable_estimate_swap' | 'concentrated_slot0';
  /** consistency figure for concentrated pools: fee-adjusted sell-side estimate, when readable */
  sellEstimate: number | null;
  /** depth guard verdict, quote side valued at `quoteUsd` */
  quoteReserveUsd: number;
  deepEnough: boolean;
};

export type PoolQuoteRead = { ok: true; quote: PoolQuote } | { ok: false; reason: string };

type PoolQuoteParams = {
  contractId: string;
  /** index of the asset and of the quote token in the pool's token vector */
  assetIdx: 0 | 1;
  quoteIdx: 0 | 1;
  assetDecimals: number;
  quoteDecimals: number;
  /** USD value of one quote token (1 for USDC, the resolved price for SolvBTC/XLM quotes) */
  quoteUsd: number;
  minQuoteUsd?: number;
};

const asBigints = (v: unknown): bigint[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'bigint') ? (v as bigint[]) : null;

async function readReservesAndFee(reader: SorobanReader, contractId: string) {
  const reservesRes = await reader.read(contractId, 'get_reserves');
  const reserves = reservesRes.ok ? asBigints(reservesRes.value) : null;
  if (!reserves || reserves.length !== 2) {
    return { reserves: null, feeBps: null, reason: reservesRes.ok ? 'get_reserves: unexpected shape' : `get_reserves: ${reservesRes.error}` };
  }
  const feeRes = await reader.read(contractId, 'get_fee_fraction');
  const feeBps = feeRes.ok && typeof feeRes.value === 'bigint' ? Number(feeRes.value) : feeRes.ok && typeof feeRes.value === 'number' ? feeRes.value : null;
  return { reserves, feeBps, reason: null };
}

/** StableSwap pool: two `estimate_swap` reads around the reserves. 4 simulations. */
export async function readStablePoolQuote(reader: SorobanReader, p: PoolQuoteParams): Promise<PoolQuoteRead> {
  const { reserves, feeBps, reason } = await readReservesAndFee(reader, p.contractId);
  if (!reserves) return { ok: false, reason: reason ?? 'reserves' };
  const inAsset = stableQuoteSizeUnits(p.assetDecimals);
  const inQuote = stableQuoteSizeUnits(p.quoteDecimals);
  const sellRes = await reader.read(p.contractId, 'estimate_swap', [scU32(p.assetIdx), scU32(p.quoteIdx), scU128(inAsset)]);
  if (!sellRes.ok || typeof sellRes.value !== 'bigint') return { ok: false, reason: `estimate_swap sell: ${sellRes.ok ? 'shape' : sellRes.error}` };
  const buyRes = await reader.read(p.contractId, 'estimate_swap', [scU32(p.quoteIdx), scU32(p.assetIdx), scU128(inQuote)]);
  if (!buyRes.ok || typeof buyRes.value !== 'bigint') return { ok: false, reason: `estimate_swap buy: ${buyRes.ok ? 'shape' : buyRes.error}` };
  const priceInQuote = stableMidPrice({
    in01: inAsset,
    out01: sellRes.value,
    in10: inQuote,
    out10: buyRes.value,
    dec0: p.assetDecimals,
    dec1: p.quoteDecimals,
  });
  if (priceInQuote === null) return { ok: false, reason: 'estimate_swap returned a zero leg' };
  return { ok: true, quote: finish(p, reserves, feeBps, priceInQuote, 'stable_estimate_swap', null) };
}

/** Concentrated pool: slot0 for the price, one sell-side estimate as a consistency figure. 4 simulations. */
export async function readConcentratedPoolPrice(reader: SorobanReader, p: PoolQuoteParams): Promise<PoolQuoteRead> {
  const { reserves, feeBps, reason } = await readReservesAndFee(reader, p.contractId);
  if (!reserves) return { ok: false, reason: reason ?? 'reserves' };
  const slot0Res = await reader.read(p.contractId, 'get_slot0');
  const slot0 = slot0Res.ok && slot0Res.value && typeof slot0Res.value === 'object' ? (slot0Res.value as Record<string, unknown>) : null;
  const sqrt = slot0 && typeof slot0.sqrt_price_x96 === 'bigint' ? slot0.sqrt_price_x96 : null;
  if (sqrt === null) return { ok: false, reason: `get_slot0: ${slot0Res.ok ? 'shape' : slot0Res.error}` };
  // slot0 is token1 per token0; flip when the asset is token1.
  const dec0 = p.assetIdx === 0 ? p.assetDecimals : p.quoteDecimals;
  const dec1 = p.assetIdx === 0 ? p.quoteDecimals : p.assetDecimals;
  const t1per0 = slot0Price(sqrt, dec0, dec1);
  if (t1per0 === null) return { ok: false, reason: 'slot0: zero sqrt price' };
  const priceInQuote = p.assetIdx === 0 ? t1per0 : 1 / t1per0;
  // Consistency: sell 0.001 asset (≥ 10× the rounding floor seen in the recon).
  const sellIn = 10n ** BigInt(Math.max(p.assetDecimals - 3, 0));
  const sellRes = await reader.read(p.contractId, 'estimate_swap', [scU32(p.assetIdx), scU32(p.quoteIdx), scU128(sellIn)]);
  let sellEstimate: number | null = null;
  if (sellRes.ok && typeof sellRes.value === 'bigint' && sellRes.value > 0n) {
    const gross = (Number(sellRes.value) / Number(sellIn)) * 10 ** (p.assetDecimals - p.quoteDecimals);
    sellEstimate = feeBps !== null ? gross / (1 - feeBps / 10_000) : gross;
  }
  return { ok: true, quote: finish(p, reserves, feeBps, priceInQuote, 'concentrated_slot0', sellEstimate) };
}

function finish(
  p: PoolQuoteParams,
  reserves: bigint[],
  feeBps: number | null,
  priceInQuote: number,
  method: PoolQuote['method'],
  sellEstimate: number | null
): PoolQuote {
  const assetReserve = Number(reserves[p.assetIdx]) / 10 ** p.assetDecimals;
  const quoteReserve = Number(reserves[p.quoteIdx]) / 10 ** p.quoteDecimals;
  const quoteReserveUsd = quoteReserve * p.quoteUsd;
  return {
    priceInQuote,
    assetReserve,
    quoteReserve,
    feeBps,
    method,
    sellEstimate,
    quoteReserveUsd,
    deepEnough: quoteReserveUsd >= (p.minQuoteUsd ?? POOL_QUOTE_MIN_QUOTE_USD),
  };
}
