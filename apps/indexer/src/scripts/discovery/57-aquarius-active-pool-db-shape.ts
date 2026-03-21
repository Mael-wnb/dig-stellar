// src/scripts/discovery/57-aquarius-active-pool-db-shape.ts
import { loadJson, nowIso, saveJson } from './00-common';

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

function buildAquariusEntitySlug(symbol0: string | null, symbol1: string | null): string {
  const left = (symbol0 ?? 'token0').toLowerCase();
  const right = (symbol1 ?? 'token1').toLowerCase();
  return `aquarius-${left}-${right}-pool`;
}

function buildAquariusPairName(symbol0: string | null, symbol1: string | null): string {
  return `${symbol0 ?? 'token0'}-${symbol1 ?? 'token1'} Aquarius Pool`;
}

async function main() {
  const probe = await loadJson<any>('55-aquarius-active-pool-probe.json');
  const assetsFile = await loadJson<any>('56-aquarius-active-pool-assets-resolve.json');

  if (!probe) throw new Error('Missing 55-aquarius-active-pool-probe.json');
  if (!assetsFile) throw new Error('Missing 56-aquarius-active-pool-assets-resolve.json');

  if (probe.poolId && assetsFile.poolId && probe.poolId !== assetsFile.poolId) {
    throw new Error(`Mismatch between 55 and 56 poolId: ${probe.poolId} !== ${assetsFile.poolId}`);
  }

  const token0 = assetsFile.token0 as string | undefined;
  const token1 = assetsFile.token1 as string | undefined;

  if (!token0 || !token1) {
    throw new Error('Missing token0/token1 in 56-aquarius-active-pool-assets-resolve.json');
  }

  const asset0 = (assetsFile.assets ?? []).find((a: any) => a.contractId === token0);
  const asset1 = (assetsFile.assets ?? []).find((a: any) => a.contractId === token1);

  if (!asset0 || !asset1) {
    throw new Error(`Could not resolve token0/token1 assets for ${token0} / ${token1}`);
  }

  const reserves = Array.isArray(assetsFile.reserves) ? assetsFile.reserves.map(String) : [];
  if (reserves.length !== 2) {
    throw new Error(`Expected 2 reserves, got ${reserves.length}`);
  }

  const entitySlug = buildAquariusEntitySlug(asset0.symbol, asset1.symbol);
  const pairName = buildAquariusPairName(asset0.symbol, asset1.symbol);

  const output = {
    generatedAt: nowIso(),
    venueSlug: 'aquarius',
    entityType: 'amm_pool',
    entitySlug,
    poolId: assetsFile.poolId,
    poolName: pairName,
    token0,
    token1,
    reserves,
    info: assetsFile.info ?? null,
    assets: assetsFile.assets,
    reserveRows: [
      {
        contractId: token0,
        symbol: asset0.symbol,
        name: asset0.name,
        decimals: asset0.decimals,
        reserveRaw: reserves[0],
        reserveScaled: scale(reserves[0], asset0.decimals),
      },
      {
        contractId: token1,
        symbol: asset1.symbol,
        name: asset1.name,
        decimals: asset1.decimals,
        reserveRaw: reserves[1],
        reserveScaled: scale(reserves[1], asset1.decimals),
      },
    ],
  };

  console.dir(output, { depth: 8 });
  await saveJson('57-aquarius-active-pool-db-shape.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});