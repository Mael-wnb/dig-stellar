import { getEnv, loadJson, nowIso, saveJson } from './00-common';

function matchesPair(token0: string, token1: string, tokenA: string, tokenB: string) {
  return (
    (token0 === tokenA && token1 === tokenB) ||
    (token0 === tokenB && token1 === tokenA)
  );
}

async function main() {
  const tokenA = getEnv('TOKEN_A');
  const tokenB = getEnv('TOKEN_B');

  const dump = await loadJson<any>('73-soroswap-dump-pairs-token-map.json');
  if (!dump || !Array.isArray(dump.rows)) {
    throw new Error('Missing or invalid 73-soroswap-dump-pairs-token-map.json');
  }

  let resolvedPairId: string | null = null;
  let matchedToken0: string | null = null;
  let matchedToken1: string | null = null;

  for (const row of dump.rows) {
    if (!row?.pairId || !row?.token0 || !row?.token1) continue;

    if (matchesPair(row.token0, row.token1, tokenA, tokenB)) {
      resolvedPairId = row.pairId;
      matchedToken0 = row.token0;
      matchedToken1 = row.token1;
      break;
    }
  }

  const output = {
    generatedAt: nowIso(),
    protocol: 'soroswap',
    inputType: 'token_pair',
    tokenA,
    tokenB,
    scannedPairs: dump.rows.length,
    resolvedPairId,
    matchedToken0,
    matchedToken1,
  };

  console.dir(output, { depth: 8 });
  await saveJson('71-soroswap-resolve-pair-from-token-pair.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});