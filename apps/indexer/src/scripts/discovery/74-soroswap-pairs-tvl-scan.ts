// Lot P (P0) — enumerate every Soroswap pair from the 53-scan output and read
// token_0 / token_1 / get_reserves on-chain, caching token symbol/decimals per
// unique token contract. Output feeds the P0 inventory (TVL ranking is done by
// the caller against our own asset_prices — the factory has no USD view).
import { getEnv, loadJson, nowIso, saveJson, simulateContractRead } from './00-common';

type ScanFile = {
  results: Array<{ index: number; pairId: string | null }>;
};

type TokenMeta = {
  tokenId: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
};

type PairRow = {
  index: number;
  pairId: string;
  token0: string | null;
  token1: string | null;
  reserve0: string | null;
  reserve1: string | null;
  error?: string;
};

function decodedString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function decodedNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// get_reserves decodes to a 2-tuple (array) of i128 values.
function decodedReserves(value: unknown): [string | null, string | null] {
  if (Array.isArray(value) && value.length >= 2) {
    const r0 = value[0];
    const r1 = value[1];
    return [
      r0 === null || r0 === undefined ? null : String(r0),
      r1 === null || r1 === undefined ? null : String(r1),
    ];
  }
  return [null, null];
}

async function main() {
  const rpcUrl = getEnv('SOROBAN_RPC_URL');
  const horizonUrl = getEnv('HORIZON_URL');
  const sourceAccount =
    process.env.STELLAR_SOURCE_ACCOUNT ??
    process.env.SOURCE_ACCOUNT ??
    'GDCRZPZYBZ24RHRO3WBPJGFDL7NDFKUQBS3ZDB6YGBJB3TGKMFYBQ3LD';

  const scan = await loadJson<ScanFile>('53-soroswap-factory-pairs-scan.json');
  if (!scan) {
    throw new Error('Run 53-soroswap-factory-pairs-scan.ts first');
  }

  // Incremental: keep rows already resolved in a previous run and only re-probe
  // pairs whose token reads failed (RPC rate limiting shows up as ok:false).
  const previous = await loadJson<{ tokens?: TokenMeta[]; pairs?: PairRow[] }>(
    '74-soroswap-pairs-tvl-scan.json'
  );
  const resolved = new Map<string, PairRow>(
    (previous?.pairs ?? [])
      .filter((p) => p.token0 !== null && p.reserve0 !== null)
      .map((p) => [p.pairId, p])
  );

  const pairIds = scan.results
    .filter((r): r is { index: number; pairId: string } => typeof r.pairId === 'string')
    .map((r) => ({ index: r.index, pairId: r.pairId }))
    .filter((r) => !resolved.has(r.pairId));

  console.log(`Probing ${pairIds.length} pairs (${resolved.size} already resolved)`);

  const tokenCache = new Map<string, TokenMeta>(
    (previous?.tokens ?? [])
      .filter((t) => t.symbol !== null || t.decimals !== null)
      .map((t) => [t.tokenId, t])
  );

  async function readTokenMeta(tokenId: string): Promise<TokenMeta> {
    const cached = tokenCache.get(tokenId);
    if (cached) return cached;

    const [symbolRes, nameRes, decimalsRes] = [
      await simulateContractRead({ rpcUrl, horizonUrl, contractId: tokenId, method: 'symbol', sourceAccount }),
      await simulateContractRead({ rpcUrl, horizonUrl, contractId: tokenId, method: 'name', sourceAccount }),
      await simulateContractRead({ rpcUrl, horizonUrl, contractId: tokenId, method: 'decimals', sourceAccount }),
    ];

    const meta: TokenMeta = {
      tokenId,
      symbol: symbolRes.ok ? decodedString(symbolRes.decoded) : null,
      name: nameRes.ok ? decodedString(nameRes.decoded) : null,
      decimals: decimalsRes.ok ? decodedNumber(decimalsRes.decoded) : null,
    };

    tokenCache.set(tokenId, meta);
    return meta;
  }

  async function probePair(entry: { index: number; pairId: string }): Promise<PairRow> {
    const { index, pairId } = entry;

    try {
      const token0Res = await simulateContractRead({ rpcUrl, horizonUrl, contractId: pairId, method: 'token_0', sourceAccount });
      const token1Res = await simulateContractRead({ rpcUrl, horizonUrl, contractId: pairId, method: 'token_1', sourceAccount });
      const reservesRes = await simulateContractRead({ rpcUrl, horizonUrl, contractId: pairId, method: 'get_reserves', sourceAccount });

      const token0 = token0Res.ok ? decodedString(token0Res.decoded) : null;
      const token1 = token1Res.ok ? decodedString(token1Res.decoded) : null;
      const [reserve0, reserve1] = reservesRes.ok
        ? decodedReserves(reservesRes.decoded)
        : [null, null];

      if (token0) await readTokenMeta(token0);
      if (token1) await readTokenMeta(token1);

      const firstError = [token0Res, token1Res, reservesRes].find((r) => !r.ok)?.error;

      return {
        index,
        pairId,
        token0,
        token1,
        reserve0,
        reserve1,
        ...(firstError ? { error: firstError } : {}),
      };
    } catch (error) {
      return {
        index,
        pairId,
        token0: null,
        token1: null,
        reserve0: null,
        reserve1: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Sequential with spacing — the concurrent version tripped RPC rate limits.
  for (const entry of pairIds) {
    const row = await probePair(entry);
    resolved.set(row.pairId, row);

    const t0 = row.token0 ? tokenCache.get(row.token0)?.symbol ?? '?' : '?';
    const t1 = row.token1 ? tokenCache.get(row.token1)?.symbol ?? '?' : '?';
    console.log(row.index, row.pairId, `${t0}/${t1}`, row.reserve0, row.reserve1, row.error ?? '');

    await new Promise((r) => setTimeout(r, 250));
  }

  const rows = Array.from(resolved.values()).sort((a, b) => a.index - b.index);

  await saveJson('74-soroswap-pairs-tvl-scan.json', {
    generatedAt: nowIso(),
    pairCount: rows.length,
    tokens: Array.from(tokenCache.values()),
    pairs: rows,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
