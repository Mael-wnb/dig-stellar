// apps/indexer/src/lib/protocols/aquarius/fetch-pool-state.ts
import 'dotenv/config';

import {
  getEnv,
  simulateContractRead,
} from '../../../scripts/discovery/00-common';
import { AquariusAsset, AquariusPoolState } from './types';

type ContractReadResult = {
  ok: boolean;
  decoded?: unknown;
  error?: unknown;
};

function scale(raw: string | null | undefined, decimals: number | null | undefined): string | null {
  if (!raw || decimals === null || decimals === undefined) return null;

  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;

  if (decimals === 0) return raw;

  const padded = digits.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, -decimals) || '0';
  const fracPart = padded.slice(-decimals).replace(/0+$/, '');
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;

  return negative ? `-${out}` : out;
}

function normalizeTokenList(value: unknown): [string, string] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`Expected 2 Aquarius pool tokens, got ${Array.isArray(value) ? value.length : 'non-array'}`);
  }

  const token0 = typeof value[0] === 'string' ? value[0] : null;
  const token1 = typeof value[1] === 'string' ? value[1] : null;

  if (!token0 || !token1) {
    throw new Error('Invalid Aquarius get_tokens result');
  }

  return [token0, token1];
}

function normalizeReserves(value: unknown): [string, string] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`Expected 2 Aquarius reserves, got ${Array.isArray(value) ? value.length : 'non-array'}`);
  }

  return [String(value[0]), String(value[1])];
}

function toDecimals(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return 7;
}

function buildAquariusEntitySlug(symbol0: string | null, symbol1: string | null): string {
  const left = (symbol0 ?? 'token0').toLowerCase();
  const right = (symbol1 ?? 'token1').toLowerCase();
  return `aquarius-${left}-${right}-pool`;
}

function buildAquariusPoolName(symbol0: string | null, symbol1: string | null): string {
  return `${symbol0 ?? 'token0'}-${symbol1 ?? 'token1'} Aquarius Pool`;
}

async function safeRead(params: {
  rpcUrl: string;
  horizonUrl: string;
  sourceAccount: string;
  contractId: string;
  method: string;
}): Promise<ContractReadResult> {
  try {
    return await simulateContractRead({
      rpcUrl: params.rpcUrl,
      horizonUrl: params.horizonUrl,
      contractId: params.contractId,
      method: params.method,
      sourceAccount: params.sourceAccount,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchTokenMetadata(params: {
  rpcUrl: string;
  horizonUrl: string;
  sourceAccount: string;
  contractId: string;
}): Promise<AquariusAsset> {
  if (params.contractId === 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA') {
    return {
      contractId: params.contractId,
      name: 'native',
      symbol: 'native',
      decimals: 7,
    };
  }

  const [nameRes, symbolRes, decimalsRes] = await Promise.all([
    safeRead({ ...params, method: 'name' }),
    safeRead({ ...params, method: 'symbol' }),
    safeRead({ ...params, method: 'decimals' }),
  ]);

  return {
    contractId: params.contractId,
    name: nameRes.ok && typeof nameRes.decoded === 'string' ? nameRes.decoded : null,
    symbol: symbolRes.ok && typeof symbolRes.decoded === 'string' ? symbolRes.decoded : null,
    decimals: toDecimals(decimalsRes.ok ? decimalsRes.decoded : null),
  };
}

export async function fetchAquariusPoolState(params?: {
  poolId?: string;
  entitySlug?: string;
  rpcUrl?: string;
  horizonUrl?: string;
  sourceAccount?: string;
  verbose?: boolean;
}): Promise<AquariusPoolState> {
  const rpcUrl = params?.rpcUrl ?? process.env.SOROBAN_RPC_URL ?? getEnv('STELLAR_RPC_URL');
  const horizonUrl = params?.horizonUrl ?? getEnv('HORIZON_URL');
  const sourceAccount =
    params?.sourceAccount ??
    process.env.STELLAR_SOURCE_ACCOUNT ??
    getEnv('STELLAR_SOURCE_ACCOUNT');

  const poolId = params?.poolId ?? process.env.AQUARIUS_POOL_ID ?? getEnv('AQUARIUS_POOL_ID');
  const verbose = params?.verbose ?? false;

  const methods = ['get_info', 'get_reserves', 'get_tokens'];

  const reads = await Promise.all(
    methods.map(async (method) => {
      const result = await safeRead({
        rpcUrl,
        horizonUrl,
        sourceAccount,
        contractId: poolId,
        method,
      });

      if (verbose) {
        console.log(method, '=>', result.ok ? result.decoded : result.error);
      }

      return { method, result };
    })
  );

  const getDecoded = (method: string) =>
    reads.find((entry) => entry.method === method)?.result?.decoded;

  const info = getDecoded('get_info') ?? null;
  const reservesRaw = normalizeReserves(getDecoded('get_reserves'));
  const [token0, token1] = normalizeTokenList(getDecoded('get_tokens'));

  const [asset0, asset1] = await Promise.all([
    fetchTokenMetadata({
      rpcUrl,
      horizonUrl,
      sourceAccount,
      contractId: token0,
    }),
    fetchTokenMetadata({
      rpcUrl,
      horizonUrl,
      sourceAccount,
      contractId: token1,
    }),
  ]);

  if (verbose) {
    console.log(token0, asset0);
    console.log(token1, asset1);
  }

  const entitySlug = params?.entitySlug ?? buildAquariusEntitySlug(asset0.symbol, asset1.symbol);
  const poolName = buildAquariusPoolName(asset0.symbol, asset1.symbol);

  return {
    venueSlug: 'aquarius',
    entityType: 'amm_pool',
    entitySlug,
    poolId,
    poolName,
    token0,
    token1,
    reservesRaw,
    info,
    assets: [asset0, asset1],
    reserveRows: [
      {
        contractId: token0,
        symbol: asset0.symbol,
        name: asset0.name,
        decimals: asset0.decimals,
        reserveRaw: reservesRaw[0],
        reserveScaled: scale(reservesRaw[0], asset0.decimals),
      },
      {
        contractId: token1,
        symbol: asset1.symbol,
        name: asset1.name,
        decimals: asset1.decimals,
        reserveRaw: reservesRaw[1],
        reserveScaled: scale(reservesRaw[1], asset1.decimals),
      },
    ],
  };
}