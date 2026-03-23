import { loadJson, nowIso, saveJson } from './00-common';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

  const token0 = getDecodedByMethod(probe, 'token_0');
  const token1 = getDecodedByMethod(probe, 'token_1');
  const reserves = getDecodedByMethod(probe, 'get_reserves');
  const pairName = getDecodedByMethod(probe, 'name');
  const pairSymbol = getDecodedByMethod(probe, 'symbol');

  if (typeof token0 !== 'string' || typeof token1 !== 'string') {
    throw new Error('Could not resolve token0/token1 from probe results');
  }

  const reserveList = Array.isArray(reserves) ? reserves : [];

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

  const entitySlug = `soroswap-${slugify(asset0.symbol)}-${slugify(asset1.symbol)}-pair`;

  const output = {
    generatedAt: nowIso(),
    venueSlug: 'soroswap',
    entityType: 'amm_pool',
    entitySlug,
    pairId: probe.pairId ?? null,
    pairName: typeof pairName === 'string' ? pairName : null,
    pairSymbol: typeof pairSymbol === 'string' ? pairSymbol : null,
    token0,
    token1,
    reserves: reserveList,
    assets: [asset0, asset1],
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