// apps/indexer/src/lib/protocols/blend/fetch-pool-state.ts

import 'dotenv/config';

import { Networks } from '@stellar/stellar-sdk';
import { PoolMetadata, PoolV2 } from '@blend-capital/blend-sdk';
import { getEnv, simulateContractRead } from '../../../scripts/discovery/00-common';
import { BlendPoolState, BlendReserveAsset, BlendReserveRow } from './types';

function scale(raw: string | null | undefined, decimals: number | null | undefined): string | null {
  if (!raw || decimals === null || decimals === undefined || !Number.isFinite(decimals)) {
    return null;
  }

  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  const d = Number(decimals);

  if (d === 0) return raw;

  const padded = digits.padStart(d + 1, '0');
  const intPart = padded.slice(0, -d) || '0';
  const fracPart = padded.slice(-d).replace(/0+$/, '');
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;

  return negative ? `-${out}` : out;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readBoolean(record: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function readUnknown(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return null;
}

async function safeTokenMethod(params: {
  rpcUrl: string;
  horizonUrl: string;
  sourceAccount: string;
  contractId: string;
  method: string;
}) {
  try {
    const result = await simulateContractRead({
      rpcUrl: params.rpcUrl,
      horizonUrl: params.horizonUrl,
      sourceAccount: params.sourceAccount,
      contractId: params.contractId,
      method: params.method,
    });

    return result.ok ? result.decoded ?? null : null;
  } catch {
    return null;
  }
}

async function fetchTokenMetadata(params: {
  rpcUrl: string;
  horizonUrl: string;
  sourceAccount: string;
  contractId: string;
  fallbackDecimals?: number | null;
}): Promise<BlendReserveAsset> {
  if (params.contractId === 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA') {
    return {
      contractId: params.contractId,
      name: 'native',
      symbol: 'native',
      decimals: params.fallbackDecimals ?? 7,
    };
  }

  const [name, symbol, decimalsRaw] = await Promise.all([
    safeTokenMethod({ ...params, method: 'name' }),
    safeTokenMethod({ ...params, method: 'symbol' }),
    safeTokenMethod({ ...params, method: 'decimals' }),
  ]);

  const decimals =
    typeof decimalsRaw === 'number'
      ? decimalsRaw
      : typeof decimalsRaw === 'string' && !Number.isNaN(Number(decimalsRaw))
        ? Number(decimalsRaw)
        : (params.fallbackDecimals ?? 7);

  return {
    contractId: params.contractId,
    name: typeof name === 'string' ? name : null,
    symbol: typeof symbol === 'string' ? symbol : null,
    decimals,
  };
}

export async function fetchBlendPoolState(params?: {
  poolId?: string;
  entitySlug?: string;
  rpcUrl?: string;
  horizonUrl?: string;
  sourceAccount?: string;
  verbose?: boolean;
}): Promise<BlendPoolState> {
  const poolId =
    params?.poolId ??
    process.env.BLEND_POOL_ID ??
    process.env.POOL_ID ??
    getEnv('BLEND_POOL_ID');

  const entitySlug =
    params?.entitySlug ??
    process.env.ENTITY_SLUG ??
    getEnv('ENTITY_SLUG');

  const rpcUrl =
    params?.rpcUrl ??
    process.env.STELLAR_RPC_URL ??
    getEnv('STELLAR_RPC_URL');

  const horizonUrl =
    params?.horizonUrl ??
    process.env.HORIZON_URL ??
    getEnv('HORIZON_URL');

  const sourceAccount =
    params?.sourceAccount ??
    process.env.STELLAR_SOURCE_ACCOUNT ??
    process.env.SOURCE_ACCOUNT ??
    'GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD';

  const verbose = params?.verbose ?? false;

  const network = {
    passphrase: Networks.PUBLIC,
    rpc: rpcUrl,
  };

  const poolMetadata = await PoolMetadata.load(network, poolId);
  const pool = await PoolV2.load(network, poolId);

  const reserves =
    pool?.reserves instanceof Map
      ? Array.from(pool.reserves.entries()).map(([assetId, reserve]) => ({
          assetId,
          reserve,
        }))
      : [];

  const assets: BlendReserveAsset[] = [];
  const reserveRows: BlendReserveRow[] = [];

  for (const entry of reserves) {
    const assetId = entry.assetId;
    const reserve = entry.reserve;

    const reserveRecord = toRecord(reserve);
    const reserveConfig = toRecord(reserve?.config);
    const reserveData = toRecord(reserve?.data);

    const fallbackDecimals = toNumberOrNull(readUnknown(reserveConfig, 'decimals'));

    const asset = await fetchTokenMetadata({
      rpcUrl,
      horizonUrl,
      sourceAccount,
      contractId: assetId,
      fallbackDecimals,
    });

    assets.push(asset);

    const row: BlendReserveRow = {
      assetId,
      symbol: asset.symbol,
      name: asset.name,
      decimals: asset.decimals,
      enabled: readBoolean(reserveConfig, 'enabled', 'is_enabled'),
      dSupplyRaw: toStringOrNull(readUnknown(reserveData, 'dSupply', 'd_supply')),
      bSupplyRaw: toStringOrNull(readUnknown(reserveData, 'bSupply', 'b_supply')),
      backstopCreditRaw: toStringOrNull(
        readUnknown(reserveData, 'backstopCredit', 'backstop_credit')
      ),
      dSupplyScaled: scale(
        toStringOrNull(readUnknown(reserveData, 'dSupply', 'd_supply')),
        asset.decimals
      ),
      bSupplyScaled: scale(
        toStringOrNull(readUnknown(reserveData, 'bSupply', 'b_supply')),
        asset.decimals
      ),
      backstopCreditScaled: scale(
        toStringOrNull(readUnknown(reserveData, 'backstopCredit', 'backstop_credit')),
        asset.decimals
      ),
      supplyCapRaw: toStringOrNull(readUnknown(reserveConfig, 'supply_cap', 'supplyCap')),
      supplyCapScaled: scale(
        toStringOrNull(readUnknown(reserveConfig, 'supply_cap', 'supplyCap')),
        asset.decimals
      ),
      borrowApr: toNumberOrNull(readUnknown(reserveRecord, 'borrowApr', 'borrow_apr')),
      estBorrowApy: toNumberOrNull(readUnknown(reserveRecord, 'estBorrowApy', 'est_borrow_apy')),
      supplyApr: toNumberOrNull(readUnknown(reserveRecord, 'supplyApr', 'supply_apr')),
      estSupplyApy: toNumberOrNull(readUnknown(reserveRecord, 'estSupplyApy', 'est_supply_apy')),
    };

    reserveRows.push(row);

    if (verbose) {
      console.log(assetId, asset);
    }
  }

  if (verbose) {
    console.log({
      poolId,
      poolName: poolMetadata?.name ?? null,
      reserveCount: reserveRows.length,
      firstReserveRow: reserveRows[0] ?? null,
    });
  }

  return {
    venueSlug: 'blend',
    entityType: 'lending_pool',
    entitySlug,
    poolId,
    poolName: typeof poolMetadata?.name === 'string' ? poolMetadata.name : null,
    reserveCount: reserveRows.length,
    metadata: {
      admin: toStringOrNull(poolMetadata?.admin),
      backstop: toStringOrNull(poolMetadata?.backstop),
      backstopRate: toNumberOrNull(poolMetadata?.backstopRate),
      oracle: toStringOrNull(poolMetadata?.oracle),
      status: toNumberOrNull(poolMetadata?.status),
      maxPositions: toNumberOrNull(poolMetadata?.maxPositions),
      minCollateral: toStringOrNull(poolMetadata?.minCollateral),
      reserveList: Array.isArray(poolMetadata?.reserveList)
        ? poolMetadata.reserveList.map((v: unknown) => String(v))
        : [],
      latestLedger: toNumberOrNull(poolMetadata?.latestLedger),
      wasmHash: toStringOrNull(poolMetadata?.wasmHash),
    },
    assets,
    reserveRows,
  };
}