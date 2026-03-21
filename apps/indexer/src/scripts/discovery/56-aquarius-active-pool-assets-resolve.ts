// src/scripts/discovery/56-aquarius-active-pool-assets-resolve.ts
import { getEnv, loadJson, nowIso, saveJson, simulateContractRead } from './00-common';
import 'dotenv/config';

type TokenMeta = {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
};

function normalizeTokenList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item : null))
    .filter((item): item is string => Boolean(item));
}

async function safeTokenMethod(params: {
  rpcUrl: string;
  horizonUrl: string;
  sourceAccount: string;
  contractId: string;
  method: string;
}) {
  const result = await simulateContractRead({
    rpcUrl: params.rpcUrl,
    horizonUrl: params.horizonUrl,
    sourceAccount: params.sourceAccount,
    contractId: params.contractId,
    method: params.method,
  });

  return result.ok ? result.decoded ?? null : null;
}

async function fetchTokenMetadata(params: {
  rpcUrl: string;
  horizonUrl: string;
  sourceAccount: string;
  contractId: string;
}): Promise<TokenMeta> {
  if (params.contractId === 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA') {
    return {
      name: 'native',
      symbol: 'native',
      decimals: 7,
    };
  }

  const [name, symbol, decimalsRaw] = await Promise.all([
    safeTokenMethod({ ...params, method: 'name' }),
    safeTokenMethod({ ...params, method: 'symbol' }),
    safeTokenMethod({ ...params, method: 'decimals' }),
  ]);

  return {
    name: typeof name === 'string' ? name : null,
    symbol: typeof symbol === 'string' ? symbol : null,
    decimals:
      typeof decimalsRaw === 'number'
        ? decimalsRaw
        : typeof decimalsRaw === 'string' && !Number.isNaN(Number(decimalsRaw))
          ? Number(decimalsRaw)
          : null,
  };
}

async function main() {
  const rpcUrl = process.env.SOROBAN_RPC_URL ?? getEnv('STELLAR_RPC_URL');
  const horizonUrl = getEnv('HORIZON_URL');
  const sourceAccount = getEnv('STELLAR_SOURCE_ACCOUNT');

  const probe = await loadJson<any>('55-aquarius-active-pool-probe.json');
  if (!probe) {
    throw new Error('Missing 55-aquarius-active-pool-probe.json');
  }

  const getTokensCall = Array.isArray(probe.results)
    ? probe.results.find((r: any) => r?.method === 'get_tokens')
    : null;

  const getInfoCall = Array.isArray(probe.results)
    ? probe.results.find((r: any) => r?.method === 'get_info')
    : null;

  const getReservesCall = Array.isArray(probe.results)
    ? probe.results.find((r: any) => r?.method === 'get_reserves')
    : null;

  const tokenIds = normalizeTokenList(getTokensCall?.decoded);
  if (tokenIds.length !== 2) {
    throw new Error(`Expected 2 Aquarius pool tokens, got ${tokenIds.length}`);
  }

  const assets: Array<{
    contractId: string;
    name: string | null;
    symbol: string | null;
    decimals: number | null;
  }> = [];

  for (const contractId of tokenIds) {
    const meta = await fetchTokenMetadata({
      rpcUrl,
      horizonUrl,
      sourceAccount,
      contractId,
    });

    const asset = {
      contractId,
      name: meta.name,
      symbol: meta.symbol,
      decimals: meta.decimals,
    };

    assets.push(asset);
    console.log(contractId, asset);
  }

  const output = {
    generatedAt: nowIso(),
    protocol: 'aquarius',
    poolId: probe.poolId,
    info: getInfoCall?.decoded ?? null,
    reserves: Array.isArray(getReservesCall?.decoded)
      ? getReservesCall.decoded.map((v: unknown) => String(v))
      : [],
    token0: tokenIds[0],
    token1: tokenIds[1],
    assets,
  };

  console.dir(output, { depth: 8 });
  await saveJson('56-aquarius-active-pool-assets-resolve.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});