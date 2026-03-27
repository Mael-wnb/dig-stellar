// apps/indexer/src/lib/protocols/soroswap/fetch-pair-state.ts
import 'dotenv/config';

import {
  getEnv,
  simulateContractRead,
} from '../../../scripts/discovery/00-common';
import { SoroswapAsset, SoroswapPairState } from './types';

type ContractReadResult = {
  ok: boolean;
  decoded?: unknown;
  error?: unknown;
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

function ensureString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing or invalid ${fieldName}`);
  }

  return value;
}

function normalizeReserves(value: unknown): [string, string] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`Expected 2 reserves, got ${Array.isArray(value) ? value.length : 'non-array'}`);
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

function buildEntitySlug(symbol0: string | null, symbol1: string | null): string {
  const left = slugify(symbol0 ?? 'token0');
  const right = slugify(symbol1 ?? 'token1');
  return `soroswap-${left}-${right}-pair`;
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
}): Promise<SoroswapAsset> {
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

export async function fetchSoroswapPairState(params?: {
  pairId?: string;
  entitySlug?: string;
  rpcUrl?: string;
  horizonUrl?: string;
  sourceAccount?: string;
  verbose?: boolean;
}): Promise<SoroswapPairState> {
  const rpcUrl = params?.rpcUrl ?? process.env.SOROBAN_RPC_URL ?? getEnv('STELLAR_RPC_URL');
  const horizonUrl = params?.horizonUrl ?? getEnv('HORIZON_URL');
  const sourceAccount =
    params?.sourceAccount ??
    process.env.SOURCE_ACCOUNT ??
    'GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD';

  const pairId = params?.pairId ?? process.env.SOROSWAP_PAIR_ID ?? getEnv('SOROSWAP_PAIR_ID');
  const verbose = params?.verbose ?? false;

  const methods = ['token_0', 'token_1', 'get_reserves', 'name', 'symbol'];

  const reads = await Promise.all(
    methods.map(async (method) => {
      const result = await safeRead({
        rpcUrl,
        horizonUrl,
        sourceAccount,
        contractId: pairId,
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

  const token0 = ensureString(getDecoded('token_0'), 'token_0');
  const token1 = ensureString(getDecoded('token_1'), 'token_1');
  const reservesRaw = normalizeReserves(getDecoded('get_reserves'));
  const pairName = typeof getDecoded('name') === 'string' ? (getDecoded('name') as string) : null;
  const pairSymbol =
    typeof getDecoded('symbol') === 'string' ? (getDecoded('symbol') as string) : null;

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

  const entitySlug = params?.entitySlug ?? buildEntitySlug(asset0.symbol, asset1.symbol);

  return {
    venueSlug: 'soroswap',
    entityType: 'amm_pool',
    entitySlug,
    pairId,
    pairName,
    pairSymbol,
    token0,
    token1,
    reservesRaw,
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