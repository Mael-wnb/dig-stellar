import { getEnv, loadJson, nowIso, saveJson, simulateContractRead } from './00-common';

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.decoded === 'string') return obj.decoded;
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.result === 'string') return obj.result;
    if (obj.ok === true && obj.value !== undefined) return asString(obj.value);
  }

  return null;
}

async function readStringMethod(params: {
  rpcUrl: string;
  horizonUrl: string;
  sourceAccount: string;
  contractId: string;
  method: string;
}) {
  try {
    const value = await simulateContractRead({
      rpcUrl: params.rpcUrl,
      horizonUrl: params.horizonUrl,
      sourceAccount: params.sourceAccount,
      contractId: params.contractId,
      method: params.method,
    } as any);

    return {
      ok: true,
      decoded: asString(value),
      raw: value,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const rpcUrl = getEnv('SOROBAN_RPC_URL');
  const horizonUrl = getEnv('HORIZON_URL');
  const sourceAccount = getEnv('STELLAR_SOURCE_ACCOUNT');

  const factoryScan = await loadJson<any>('53-soroswap-factory-pairs-scan.json');
  if (!factoryScan || !Array.isArray(factoryScan.results)) {
    throw new Error('Missing or invalid 53-soroswap-factory-pairs-scan.json');
  }

  const maxPairs = Number(process.env.MAX_SCAN_PAIRS ?? 40);

  const pairIds: string[] = factoryScan.results
    .map((item: any) => item?.pairId)
    .filter((value: unknown): value is string => typeof value === 'string' && value.startsWith('C'))
    .slice(0, maxPairs);

  const rows: Array<{
    pairId: string;
    token0: string | null;
    token1: string | null;
  }> = [];

  for (let i = 0; i < pairIds.length; i += 1) {
    const pairId = pairIds[i];
    console.log(`Reading pair ${i + 1}/${pairIds.length}: ${pairId}`);

    const token0Call = await readStringMethod({
      rpcUrl,
      horizonUrl,
      sourceAccount,
      contractId: pairId,
      method: 'token_0',
    });

    const token1Call = await readStringMethod({
      rpcUrl,
      horizonUrl,
      sourceAccount,
      contractId: pairId,
      method: 'token_1',
    });

    rows.push({
      pairId,
      token0: token0Call.ok ? token0Call.decoded ?? null : null,
      token1: token1Call.ok ? token1Call.decoded ?? null : null,
    });
  }

  const output = {
    generatedAt: nowIso(),
    scannedPairs: rows.length,
    rows,
  };

  console.dir(output.rows.slice(0, 10), { depth: 5 });
  await saveJson('73-soroswap-dump-pairs-token-map.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});