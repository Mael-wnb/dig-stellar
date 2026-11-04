// Top 5 pools by TVL from the production API, one call.
//   pnpm -C packages/sdk example
// Imports from ../src so it runs without a build; a consumer writes
// `import { DigStellarClient } from '@getdig/stellar-api'`.
import { DigStellarClient, DigApiError, asOfDate, isStale } from '../src/index';

const client = new DigStellarClient();

try {
  const pools = await client.listPools({ sort: 'tvlUsd', order: 'desc' });
  console.log(`${pools.length} pools, top 5 by TVL (${client.baseUrl}):`);
  for (const pool of pools.slice(0, 5)) {
    const tvl = pool.metrics.tvlUsd;
    console.log(
      `  ${pool.id.padEnd(40)} ${pool.protocol.name.padEnd(10)} ` +
        `$${tvl === null ? 'n/a' : Math.round(tvl).toLocaleString('en-US').padStart(12)}` +
        `  stale=${String(isStale(pool))}  asOf=${asOfDate(pool)?.toISOString() ?? 'n/a'}`,
    );
  }
} catch (error) {
  if (error instanceof DigApiError) {
    console.error(`API error ${error.status}${error.retryAfterSeconds !== undefined ? ` (retry after ${error.retryAfterSeconds}s)` : ''}: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
