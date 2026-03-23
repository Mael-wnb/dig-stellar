import { getEnv, nowIso, saveJson, simulateContractRead } from './00-common';

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'bigint') return Number(value);

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    if (typeof obj.decoded === 'number') return obj.decoded;
    if (typeof obj.decoded === 'string') {
      const n = Number(obj.decoded);
      if (Number.isFinite(n)) return n;
    }

    if (obj.ok === true && obj.value !== undefined) return asNumber(obj.value);
    if (obj.result !== undefined) return asNumber(obj.result);
    if (obj.raw !== undefined) return asNumber(obj.raw);
  }

  return null;
}

async function main() {
  const rpcUrl = getEnv('SOROBAN_RPC_URL');
  const horizonUrl = getEnv('HORIZON_URL');
  const sourceAccount =
    process.env.STELLAR_SOURCE_ACCOUNT ??
    process.env.SOURCE_ACCOUNT ??
    'GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD';

  const factoryId = getEnv('SOROSWAP_FACTORY_ID');

  const lengthRes = await simulateContractRead({
    rpcUrl,
    horizonUrl,
    contractId: factoryId,
    method: 'all_pairs_length',
    sourceAccount,
  });

  if (!lengthRes.ok) {
    throw new Error(`Could not read all_pairs_length: ${lengthRes.error}`);
  }

  const totalPairs = asNumber(lengthRes);
  if (totalPairs === null) {
    throw new Error('Could not decode all_pairs_length');
  }

  const envMaxPairs = process.env.MAX_PAIRS ? Number(process.env.MAX_PAIRS) : null;
  const maxPairs =
    envMaxPairs && Number.isFinite(envMaxPairs)
      ? Math.min(envMaxPairs, totalPairs)
      : totalPairs;

  const results: Array<{
    index: number;
    pairId: string | null;
    raw: unknown;
  }> = [];

  console.log(`Factory ${factoryId}`);
  console.log(`all_pairs_length => ${totalPairs}`);
  console.log(`Scanning ${maxPairs} pairs`);

  for (let i = 0; i < maxPairs; i += 1) {
    const pairRes = await simulateContractRead({
      rpcUrl,
      horizonUrl,
      contractId: factoryId,
      method: 'all_pairs',
      args: [{ type: 'u32', value: i }],
      sourceAccount,
    });

    const pairId = pairRes.ok ? pairRes.decoded ?? null : null;

    results.push({
      index: i,
      pairId: typeof pairId === 'string' ? pairId : null,
      raw: pairRes,
    });

    console.log(i, '=>', pairId ?? pairRes.error);
  }

  await saveJson('53-soroswap-factory-pairs-scan.json', {
    generatedAt: nowIso(),
    factoryId,
    totalPairs,
    scannedPairs: results.length,
    results,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});