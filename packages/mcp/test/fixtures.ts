// Trimmed production shapes (schemas in apps/api/openapi/openapi.v1.yaml), values invented.
const fresh = { updatedAt: '2026-11-05T15:00:40.000Z', stale: false, isStale: false, staleAfterSeconds: 2700, ageSeconds: 120 };
const stale = { updatedAt: '2026-11-05T10:00:00.000Z', stale: true, isStale: true, staleAfterSeconds: 2700, ageSeconds: 18000 };

export const protocols = [
  { id: 'blend', name: 'Blend', type: 'lending', chain: 'stellar', logoUrl: null, tvlUsd: 160_988_033, volume24hUsd: 0, fees24hUsd: 1200, avgSupplyApy: 0.041, avgBorrowApy: 0.07, topAssets: [{ symbol: 'USDC', logoUrl: null, tvlUsd: 100_000_000 }], assetCount: 6, ...fresh },
  { id: 'aquarius', name: 'Aquarius', type: 'amm', chain: 'stellar', logoUrl: null, tvlUsd: 40_000_000, volume24hUsd: 1_500_000, fees24hUsd: 4000, avgSupplyApy: null, avgBorrowApy: null, topAssets: [], assetCount: 12, ...stale },
];

const protocolRef = { id: 'blend', name: 'Blend', type: 'lending', logoUrl: null };

export const pools = [
  { id: 'blend-fixed-pool', name: 'Fixed Pool', type: 'lending_pool', protocol: protocolRef, chain: 'stellar', contractAddress: 'CA...', tokens: [{ assetId: 'USDC', symbol: 'USDC', logoUrl: null, role: 'reserve' }], metrics: { tvlUsd: 156_538_821, volume24hUsd: 0, fees24hUsd: 900, totalSuppliedUsd: 200_000_000, totalBorrowedUsd: 50_000_000, supplyApy: 0.0412, borrowApy: 0.071, swaps24h: null }, ...fresh },
  { id: 'aquarius-aqua-usdc-pool', name: 'AQUA/USDC', type: 'amm_pool', protocol: { id: 'aquarius', name: 'Aquarius', type: 'amm', logoUrl: null }, chain: 'stellar', contractAddress: 'CB...', tokens: [], metrics: { tvlUsd: 2_000_000, volume24hUsd: 120_000, fees24hUsd: 360, totalSuppliedUsd: null, totalBorrowedUsd: null, supplyApy: null, borrowApy: null, swaps24h: 410 }, ...fresh },
];

export const poolLending = {
  id: 'blend-fixed-pool', name: 'Fixed Pool', protocol: protocolRef, chain: 'stellar', type: 'lending_pool', contractAddress: 'CA...',
  metrics: { tvlUsd: 156_538_821, totalSuppliedUsd: 200_000_000, totalBorrowedUsd: 50_000_000, totalBackstopCreditUsd: 1_000_000, netLiquidityUsd: 150_000_000, supplyApy: 0.0412, borrowApy: 0.071, volume24hUsd: 0, fees24hUsd: 900, events24h: 300 },
  reserves: [
    { assetId: 'USDC', symbol: 'USDC', name: 'USD Coin', logoUrl: null, decimals: 7, priceUsd: 1, supplied: 100_000_000, borrowed: 30_000_000, backstopCredit: 0, supplyCap: null, supplyApr: 0.04, supplyApy: 0.0408, borrowApr: 0.068, borrowApy: 0.0704 },
    { assetId: 'XLM', symbol: 'XLM', name: 'Stellar Lumens', logoUrl: null, decimals: 7, priceUsd: 0.3, supplied: 50_000_000, borrowed: 10_000_000, backstopCredit: 0, supplyCap: null, supplyApr: 0.01, supplyApy: 0.0101, borrowApr: 0.03, borrowApy: 0.0304 },
  ],
  ...fresh,
};

export const poolAmm = {
  id: 'aquarius-aqua-usdc-pool', name: 'AQUA/USDC', protocol: { id: 'aquarius', name: 'Aquarius', type: 'amm', logoUrl: null }, chain: 'stellar', type: 'amm_pool', contractAddress: 'CB...',
  metrics: { tvlUsd: 2_000_000, volume24hUsd: 120_000, fees24hUsd: 360, events24h: 410, swaps24h: 410, trades24h: null },
  tokens: [{ assetId: 'AQUA', symbol: 'AQUA', logoUrl: null, role: 'token0' }, { assetId: 'USDC', symbol: 'USDC', logoUrl: null, role: 'token1' }],
  ...stale,
};

export const series = {
  slug: 'blend-fixed-pool', covered: true, kind: 'tvl',
  points: [{ day: '2026-11-03', tvlUsd: 150_000_000 }, { day: '2026-11-04', tvlUsd: 155_000_000 }, { day: '2026-11-05', tvlUsd: 156_538_821 }],
  first: '2026-11-03', last: '2026-11-05', updatedAt: '2026-11-05T15:07:21.542Z',
};

export const networkStats = {
  xlmPriceUsd: 0.3012, xlmPriceChange24hPct: -1.25, stellarTvlUsd: 230_100_000, activeWallets: 120_000, stableMcapUsd: 500_000_000,
  dexVolume24hUsd: 3_200_000, protocolCount: 6, usdcSupplyUsd: 450_000_000, avgTxFeeXlm: 0.00001,
  updatedAt: '2026-11-05T15:00:07.000Z', isStale: false, staleAfterSeconds: 2700,
};

const segment = (runAt: string) => ({ runAt, state: 'ok', durationMs: 1200, message: null });

export const opsStatus = {
  window: '24h', generatedAt: '2026-11-05T15:10:00.000Z', cadenceMinutes: 15, staleAfterSeconds: 2700,
  historySince: '2026-11-04T15:10:00.000Z', noDataBefore: null,
  runs: [{ runAt: '2026-11-05T14:45:07.000Z' }, { runAt: '2026-11-05T15:00:07.000Z' }],
  gaps: [],
  overall: { state: 'operational', lastRunAt: '2026-11-05T15:00:07.000Z', missedCycles24h: 0, failedSteps24h: 0 },
  components: [
    { id: 'blend', kind: 'step', label: 'Blend', state: 'ok', availability24h: 1, segments: [segment('2026-11-05T14:45:07.000Z'), segment('2026-11-05T15:00:07.000Z')] },
    { id: 'rpc', kind: 'rpc', label: 'Soroban RPC', state: 'degraded', availability24h: 0.98, segments: [segment('2026-11-05T15:00:07.000Z')] },
  ],
  priceSources: { totalAssets: 40, pricedAssets: 38, unpricedAssets: 2, singleSourceAssets: 5, referenceAssets: 3, disagreements: 0 },
};

export const routes = {
  '/v1/protocols': { body: protocols },
  '/v1/pools': { body: pools },
  '/v1/pools?protocol=blend&sort=supplyApy&order=desc': { body: [pools[0]] },
  '/v1/pools/blend-fixed-pool': { body: poolLending },
  '/v1/pools/aquarius-aqua-usdc-pool': { body: poolAmm },
  '/v1/pools/blend-fixed-pool/series': { body: series },
  '/v1/network/stats': { body: networkStats },
  '/v1/ops/status': { body: opsStatus },
};
