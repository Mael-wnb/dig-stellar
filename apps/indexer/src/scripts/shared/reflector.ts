// apps/indexer/src/scripts/shared/reflector.ts
//
// Reflector price oracle reader (price-sources v2, phase B) — and, since Blend's
// per-pool oracle adapters expose the same SEP-40 surface (`lastprice`,
// `decimals`, `base`, `assets`), the generic oracle reader they share.
//
// Public mainnet Reflector feeds (ReflectorPulse: free reads, no `track`
// prepayment — ids from the official Stellar docs "Oracle Providers" page,
// verified on-chain in 00-recon.md §c and 05-phase-b-design.md §2):
//   CEX/DEX  — base Other("USD"),  14 decimals, 300 s resolution: BTC, ETH, XLM, USDC, EURC, …
//   Stellar DEX — base Stellar(USDC), 14 decimals, 300 s: native, AQUA, EURC, USDGLO, CETES,
//                 USTRY, TESOURO, SolvBTC, PYUSD, yUSDC (52 assets)
// `lastprice(asset) -> Option<PriceData { price: i128, timestamp: u64 (seconds) }>`,
// price = price / 10^decimals, timestamp aligned to floor(now / resolution) * resolution.
// No batch call exists: one simulation per asset.
import { Address, xdr } from '@stellar/stellar-sdk';
import type { SorobanReader } from './soroban-read';

export const REFLECTOR_CEX_CONTRACT = 'CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN';
export const REFLECTOR_SDEX_CONTRACT = 'CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M';
export const REFLECTOR_RESOLUTION_SEC = 300;
// Fresh ≤ 900 s (three missed 300 s ticks): a single missed tick plus our run
// offset must not flip the primary source every other run; older → absent.
export const ORACLE_MAX_AGE_SEC = 900;

export type OracleAsset =
  | { kind: 'other'; symbol: string } // Asset::Other(Symbol) — external tickers (CEX feed)
  | { kind: 'stellar'; contractId: string }; // Asset::Stellar(Address) — on-chain tokens

/** ScVal encoding of the Reflector `Asset` enum: Vec[Symbol(variant), payload]. */
export function oracleAssetScVal(asset: OracleAsset): xdr.ScVal {
  if (asset.kind === 'other') {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Other'), xdr.ScVal.scvSymbol(asset.symbol)]);
  }
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Stellar'), new Address(asset.contractId).toScVal()]);
}

/** Exact fixed-point → float: integer and fractional parts split before the division. */
export function scalePrice(price: bigint, decimals: number): number {
  const base = 10n ** BigInt(decimals);
  const sign = price < 0n ? -1 : 1;
  const abs = price < 0n ? -price : price;
  return sign * (Number(abs / base) + Number(abs % base) / Number(base));
}

export type OraclePrice = {
  priceUsd: number;
  observedAt: Date;
  ageSec: number;
};

/**
 * Decode the native value of `lastprice`: `null` (Option::None) or
 * `{ price: bigint, timestamp: bigint }`. Returns null for anything else.
 */
export function decodeOraclePrice(raw: unknown, decimals: number, now: Date): OraclePrice | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const price = rec.price;
  const ts = rec.timestamp;
  if (typeof price !== 'bigint' || (typeof ts !== 'bigint' && typeof ts !== 'number')) return null;
  const priceUsd = scalePrice(price, decimals);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  const observedAt = new Date(Number(ts) * 1000);
  const ageSec = Math.round((now.getTime() - observedAt.getTime()) / 1000);
  return { priceUsd, observedAt, ageSec };
}

export type OracleVerdict = { fresh: boolean; reason: string | null };

/** The freshness guard on the oracle's own timestamp (not on our read time). */
export function judgeOraclePrice(price: OraclePrice | null, maxAgeSec = ORACLE_MAX_AGE_SEC): OracleVerdict {
  if (!price) return { fresh: false, reason: 'no price (None)' };
  if (price.ageSec > maxAgeSec) {
    return { fresh: false, reason: `stale oracle timestamp (${price.ageSec}s > ${maxAgeSec}s)` };
  }
  // A timestamp in the future beyond clock skew means a pegged / synthetic entry
  // stamped with the ledger time (see isPeggedTimestamp); it is not stale.
  return { fresh: true, reason: null };
}

/**
 * Blend's oracle adapters stamp hard-coded pegs (USDC, PYUSD, USDGLO, oUSD = 1)
 * with the CURRENT ledger time instead of a 300 s-aligned observation. Such an
 * entry is a peg assumption, not a market observation: it is reported as
 * `pegged` so it never counts as an independent source.
 */
export function isPeggedTimestamp(observedAt: Date, now: Date, resolutionSec = REFLECTOR_RESOLUTION_SEC): boolean {
  const ts = Math.round(observedAt.getTime() / 1000);
  const onGrid = ts % resolutionSec === 0;
  const nearNow = Math.abs(now.getTime() / 1000 - ts) <= 60;
  return !onGrid && nearNow;
}

export type OracleRead =
  | { ok: true; price: OraclePrice; pegged: boolean; decimals: number }
  | { ok: false; reason: string };

const decimalsCache = new Map<string, number>();

/** `decimals()` of an oracle contract, cached per process (one read per run). */
export async function readOracleDecimals(reader: SorobanReader, contractId: string): Promise<number | null> {
  const cached = decimalsCache.get(contractId);
  if (cached !== undefined) return cached;
  const res = await reader.read(contractId, 'decimals');
  if (!res.ok) return null;
  const n = typeof res.value === 'bigint' ? Number(res.value) : typeof res.value === 'number' ? res.value : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 30) return null;
  decimalsCache.set(contractId, n);
  return n;
}

/** One `lastprice` read with the freshness guard applied. Never throws. */
export async function readOraclePrice(
  reader: SorobanReader,
  contractId: string,
  asset: OracleAsset,
  options: { now: Date; maxAgeSec?: number; decimals?: number }
): Promise<OracleRead> {
  const decimals = options.decimals ?? (await readOracleDecimals(reader, contractId));
  if (decimals === null) return { ok: false, reason: 'decimals() unreadable' };
  const res = await reader.read(contractId, 'lastprice', [oracleAssetScVal(asset)]);
  if (!res.ok) return { ok: false, reason: `${res.kind}: ${res.error}` };
  const price = decodeOraclePrice(res.value, decimals, options.now);
  const verdict = judgeOraclePrice(price, options.maxAgeSec);
  if (!verdict.fresh || !price) return { ok: false, reason: verdict.reason ?? 'unreadable' };
  return { ok: true, price, pegged: isPeggedTimestamp(price.observedAt, options.now), decimals };
}

export const reflectorSourceLabel = (feed: 'cex' | 'sdex', symbol: string): string =>
  `reflector_${feed}_${symbol === 'native' ? 'xlm' : symbol.toLowerCase()}`;
