import { getEnv, nowIso, saveJson, simulateContractRead } from './00-common';

async function safeRead(params: {
  rpcUrl: string;
  horizonUrl: string;
  sourceAccount: string;
  contractId: string;
  method: string;
  args?: Array<{ type: string; value: string | number | boolean }>;
}) {
  try {
    const result = await simulateContractRead({
      rpcUrl: params.rpcUrl,
      horizonUrl: params.horizonUrl,
      sourceAccount: params.sourceAccount,
      contractId: params.contractId,
      method: params.method,
      args: params.args,
    } as any);

    return {
      ok: true,
      method: params.method,
      decoded: result?.decoded ?? null,
      raw: result,
    };
  } catch (error) {
    return {
      ok: false,
      method: params.method,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const rpcUrl = getEnv('SOROBAN_RPC_URL');
  const horizonUrl = getEnv('HORIZON_URL');
  const sourceAccount = getEnv('STELLAR_SOURCE_ACCOUNT');

  const poolId =
    process.env.AQUARIUS_POOL_ID ??
    'CA6PUJLBYKZKUEKLZJMKBZLEKP2OTHANDEOWSFF44FTSYLKQPIICCJBE';

  const calls = [
    'get_info',
    'get_reserves',
    'token_a',
    'token_b',
    'get_tokens',
    'tokens',
    'share_token',
    'plane',
    'name',
    'symbol',
    'decimals',
  ];

  const results = [];
  for (const method of calls) {
    const res = await safeRead({
      rpcUrl,
      horizonUrl,
      sourceAccount,
      contractId: poolId,
      method,
    });
    results.push(res);

    if (res.ok) {
      console.log(`${method} =>`, res.decoded);
    } else {
      console.log(`${method} => ERROR:`, res.error);
    }
  }

  const output = {
    generatedAt: nowIso(),
    protocol: 'aquarius',
    poolId,
    results,
  };

  await saveJson('55-aquarius-active-pool-probe.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});