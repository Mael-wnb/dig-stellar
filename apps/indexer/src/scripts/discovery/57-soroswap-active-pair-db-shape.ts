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

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildSoroswapEntitySlug(symbol0: string | null, symbol1: string | null): string {
  const left = slugify(symbol0 ?? 'token0');
  const right = slugify(symbol1 ?? 'token1');
  return `soroswap-${left}-${right}-pair`;
}

function getDecodedByMethod(probe: any, method: string): unknown {
  const row = Array.isArray(probe?.results)
    ? probe.results.find((item: any) => item?.method === method)
    : null;

  return row?.decoded ?? null;
}

function findAsset(assetsResolved: any, contractId: string) {
  if (!assetsResolved || !contractId) return null;

  const direct = assetsResolved[contractId];
  if (direct && typeof direct === 'object') {
    return {
      contractId,
      name: direct.name ?? 'Unknown',
      symbol: direct.symbol ?? 'unknown',
      decimals: direct.decimals ?? 7,
    };
  }

  const candidates = [
    ...(Array.isArray(assetsResolved.assets) ? assetsResolved.assets : []),
    ...(Array.isArray(assetsResolved.rows) ? assetsResolved.rows : []),
    ...(Array.isArray(assetsResolved.results) ? assetsResolved.results : []),
  ];

  const found = candidates.find((item: any) => {
    const id =
      item?.contractId ??
      item?.contract_id ??
      item?.assetId ??
      item?.asset_id;
    return id === contractId;
  });

  if (!found) return null;

  return {
    contractId,
    name: found.name ?? 'Unknown',
    symbol: found.symbol ?? 'unknown',
    decimals: found.decimals ?? 7,
  };
}

async function main() {
  const probe = await loadJson<any>('55-soroswap-active-pair-probe.json');
  const assetsResolved = await loadJson<any>('56-soroswap-active-pair-assets-resolve.json');
  const events = await loadJson<any>('50-soroswap-pair-events.json');

  if (!probe) throw new Error('Missing 55-soroswap-active-pair-probe.json');
  if (!assetsResolved) throw new Error('Missing 56-soroswap-active-pair-assets-resolve.json');
  if (!events) throw new Error('Missing 50-soroswap-pair-events.json');

  const envPairId = process.env.SOROSWAP_PAIR_ID ?? null;

  const probePairId =
    typeof probe?.pairId === 'string' && probe.pairId.length > 0 ? probe.pairId : null;

  const assetsPairId =
    typeof assetsResolved?.pairId === 'string' && assetsResolved.pairId.length > 0
      ? assetsResolved.pairId
      : null;

  const eventsPairId =
    typeof events?.pairId === 'string' && events.pairId.length > 0 ? events.pairId : null;

  if (!probePairId) {
    throw new Error('Missing pairId in 55-soroswap-active-pair-probe.json');
  }

  if (!assetsPairId) {
    throw new Error('Missing pairId in 56-soroswap-active-pair-assets-resolve.json');
  }

  if (!eventsPairId) {
    throw new Error('Missing pairId in 50-soroswap-pair-events.json');
  }

  if (envPairId && probePairId !== envPairId) {
    throw new Error(`Mismatch between SOROSWAP_PAIR_ID and 55 pairId: ${envPairId} !== ${probePairId}`);
  }

  if (envPairId && assetsPairId !== envPairId) {
    throw new Error(`Mismatch between SOROSWAP_PAIR_ID and 56 pairId: ${envPairId} !== ${assetsPairId}`);
  }

  if (envPairId && eventsPairId !== envPairId) {
    throw new Error(`Mismatch between SOROSWAP_PAIR_ID and 50 pairId: ${envPairId} !== ${eventsPairId}`);
  }

  if (probePairId !== assetsPairId) {
    throw new Error(`Mismatch between 55 and 56 pairId: ${probePairId} !== ${assetsPairId}`);
  }

  if (probePairId !== eventsPairId) {
    throw new Error(`Mismatch between 55 and 50 pairId: ${probePairId} !== ${eventsPairId}`);
  }

  const token0 = getDecodedByMethod(probe, 'token_0');
  const token1 = getDecodedByMethod(probe, 'token_1');
  const reserves = getDecodedByMethod(probe, 'get_reserves');
  const pairName = getDecodedByMethod(probe, 'name');
  const pairSymbol = getDecodedByMethod(probe, 'symbol');

  if (typeof token0 !== 'string' || typeof token1 !== 'string') {
    throw new Error('Could not resolve token0/token1 from probe results');
  }

  const reserveList = Array.isArray(reserves) ? reserves.map(String) : [];
  if (reserveList.length !== 2) {
    throw new Error(`Expected 2 reserves, got ${reserveList.length}`);
  }

  const asset0 = findAsset(assetsResolved, token0);
  const asset1 = findAsset(assetsResolved, token1);

  if (!asset0 || !asset1) {
    console.dir(
      {
        message: 'Asset resolve debug',
        token0,
        token1,
        assetsResolvedKeys: Object.keys(assetsResolved ?? {}),
        assetsResolved,
      },
      { depth: 6 }
    );
    throw new Error(`Could not resolve token0/token1 assets for ${token0} / ${token1}`);
  }

  const entitySlug = buildSoroswapEntitySlug(asset0.symbol, asset1.symbol);

  const output = {
    generatedAt: nowIso(),
    venueSlug: 'soroswap',
    entityType: 'amm_pool',
    entitySlug,
    pairId: probePairId,
    pairName: typeof pairName === 'string' ? pairName : null,
    pairSymbol: typeof pairSymbol === 'string' ? pairSymbol : null,
    token0,
    token1,
    reserves: reserveList,
    assets: [asset0, asset1],
    reserveRows: [
      {
        contractId: token0,
        symbol: asset0.symbol,
        name: asset0.name,
        decimals: asset0.decimals,
        reserveRaw: reserveList[0],
        reserveScaled: scale(reserveList[0], asset0.decimals),
      },
      {
        contractId: token1,
        symbol: asset1.symbol,
        name: asset1.name,
        decimals: asset1.decimals,
        reserveRaw: reserveList[1],
        reserveScaled: scale(reserveList[1], asset1.decimals),
      },
    ],
    recentEventCount: events.count ?? 0,
    firstEvent: events.firstDecodedEvent ?? null,
  };

  console.dir(output, { depth: 8 });
  await saveJson('57-soroswap-active-pair-db-shape.json', output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});