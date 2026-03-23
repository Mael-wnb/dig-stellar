// src/scripts/discovery/55-aquarius-active-pool-probe.ts
import { getEnv, nowIso, saveJson, simulateContractRead } from './00-common';
import 'dotenv/config';

type ContractArg = { type: string; value: string | number | boolean };

type ProbeResult = {
  ok: boolean;
  method: string;
  decoded?: unknown;
  raw?: unknown;
  error?: string;
};

async function safeRead(params: {
  rpcUrl: string;
  horizonUrl: string;
  sourceAccount: string;
  contractId: string;
  method: string;
  args?: ContractArg[];
}): Promise<ProbeResult> {
  try {
    const result = await simulateContractRead({
      rpcUrl: params.rpcUrl,
      horizonUrl: params.horizonUrl,
      sourceAccount: params.sourceAccount,
      contractId: params.contractId,
      method: params.method,
      args: params.args as any,
    });

    return {
      ok: Boolean(result.ok),
      method: params.method,
      decoded: result.decoded ?? null,
      raw: result.raw ?? result,
      error: result.ok ? undefined : result.error ?? 'Unknown contract read error',
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
  const rpcUrl = process.env.SOROBAN_RPC_URL ?? getEnv('STELLAR_RPC_URL');
  const horizonUrl = getEnv('HORIZON_URL');
  const sourceAccount = getEnv('STELLAR_SOURCE_ACCOUNT');

  const poolId =
    process.env.AQUARIUS_POOL_ID ??
    'CA6PUJLBYKZKUEKLZJMKBZLEKP2OTHANDEOWSFF44FTSYLKQPIICCJBE';

  // Aquarius pools: on garde uniquement les méthodes réellement utiles/supportées.
  const calls = ['get_info', 'get_reserves', 'get_tokens'];

  const results: ProbeResult[] = [];

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
    supportedMethods: calls,
    results,
  };

  await saveJson('55-aquarius-active-pool-probe.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});