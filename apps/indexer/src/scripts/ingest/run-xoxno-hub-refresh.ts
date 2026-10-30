// apps/indexer/src/scripts/ingest/run-xoxno-hub-refresh.ts
//
// One XOXNO hub refresh (Lot XO, XO-1): fetch the hub's markets on-chain →
// persist state (reserve_snapshots per market) → persist pool metrics.
// Spawned per hub entity by 71-refresh-all-metrics.ts (ENTITY_SLUG + XOXNO_POOL_ID);
// the market list, hub id and the 24 h static-params cache come from the
// entity's metadata (seeded by scripts/bootstrap/xoxno-upsert-core.ts). Exits
// non-zero on failure — the orchestrator retries and keeps the step non-fatal
// for the rest of the job.
//
// Env: XOXNO_PARAMS_REFRESH=1 forces a chain re-read of every market's static
// params this run (otherwise: cache ≤ 24 h, same app version, market known).
//
// E2 (Lot E): install RPC latency/error capture BEFORE any HTTP-touching import.
import '../../lib/ops-capture';

import 'dotenv/config';

import { fetchXoxnoHubState } from '../../lib/protocols/xoxno/fetch-hub-state';
import { persistXoxnoHubState } from '../../lib/protocols/xoxno/persist-hub-state';
import { isAggregatorFallbackEligible } from '../../lib/protocols/xoxno/pricing-scope';
import { persistXoxnoHubMetrics } from '../../lib/protocols/xoxno/persist-pool-metrics';
import {
  XOXNO_EXPECTED_APP_VERSION,
  XOXNO_POOL_CONTRACT,
  type XoxnoHubEntityMetadata,
} from '../../lib/protocols/xoxno/types';
import { maskRpcUrl, resolveRpcUrl } from '../../lib/rpc-config';
import { saveJson } from '../discovery/00-common';
import { createPgClient } from '../shared/db';
import { getEntityBySlugOrThrow } from '../shared/lookup';

async function main() {
  const entitySlug = process.env.ENTITY_SLUG?.trim();
  const poolId = process.env.XOXNO_POOL_ID?.trim() ?? XOXNO_POOL_CONTRACT;
  const sourceAccount = process.env.STELLAR_SOURCE_ACCOUNT?.trim() ?? '';
  const expectedAppVersion = Number(process.env.XOXNO_EXPECTED_APP_VERSION ?? XOXNO_EXPECTED_APP_VERSION);
  const debug = process.env.DEBUG === '1' || process.env.XOXNO_DEBUG === '1';
  const forceParamsRefresh = process.env.XOXNO_PARAMS_REFRESH === '1';

  if (!entitySlug) throw new Error('Missing ENTITY_SLUG');
  if (!sourceAccount) throw new Error('Missing STELLAR_SOURCE_ACCOUNT (needed for read-only simulations)');
  if (poolId !== XOXNO_POOL_CONTRACT) {
    throw new Error(`XOXNO_POOL_ID ${poolId} is not the known XOXNO pool ${XOXNO_POOL_CONTRACT} — refusing to read an unknown contract`);
  }

  console.log('=== XOXNO hub refresh ===');
  console.log({ entitySlug, poolId, rpc: maskRpcUrl(resolveRpcUrl()), expectedAppVersion, forceParamsRefresh, debug });

  const client = createPgClient();
  await client.connect();

  try {
    const entity = await getEntityBySlugOrThrow(client, entitySlug);
    const metaRes = await client.query(`select metadata from entities where id = $1`, [entity.id]);
    const seedMetadata = metaRes.rows[0]?.metadata as XoxnoHubEntityMetadata | undefined;
    if (!seedMetadata || typeof seedMetadata.hubId !== 'number' || !Array.isArray(seedMetadata.markets)) {
      throw new Error(`${entitySlug}: entity metadata lacks hubId / markets — run bootstrap (xoxno-upsert-core.ts)`);
    }

    // Aggregator scope: the persist keys pricing rules on the assets row symbol
    // (an existing row is never renamed by the seed), so resolve the symbols the
    // same way here and only send the fallback-eligible markets to the aggregator.
    const symbolRes = await client.query(
      `select contract_address, symbol from assets where contract_address = any($1::text[])`,
      [seedMetadata.markets.map((m) => m.asset)]
    );
    const dbSymbol = new Map<string, string | null>(
      (symbolRes.rows as Array<{ contract_address: string; symbol: string | null }>).map((r) => [r.contract_address, r.symbol])
    );
    const priceFallbackAssets = new Set(
      seedMetadata.markets.filter((m) => isAggregatorFallbackEligible(dbSymbol.get(m.asset) ?? m.symbol)).map((m) => m.asset)
    );

    const hubState = await fetchXoxnoHubState({
      entitySlug,
      hubId: seedMetadata.hubId,
      hubName: seedMetadata.hubName,
      markets: seedMetadata.markets,
      sourceAccount,
      priceFallbackAssets,
      paramsCache: seedMetadata.paramsCache ?? null,
      forceParamsRefresh,
      poolContract: poolId,
      expectedAppVersion,
      verbose: debug,
    });

    console.log(
      `[xoxno] ${entitySlug}: params ${hubState.callPlan.paramsFromCache} from cache / ${hubState.callPlan.paramsFromChain} from chain ` +
        `(cache fetchedAt ${hubState.paramsCache.fetchedAt}); aggregator keys ${hubState.callPlan.priceFallbackKeys} in ${hubState.callPlan.priceChunks} chunk(s); ` +
        `rpc calls ${hubState.readStats.calls} (retries ${hubState.readStats.retries}, failures ${hubState.readStats.failures})`
    );

    if (debug) await saveJson('lib-xoxno-hub-state.json', hubState);

    const persistedState = await persistXoxnoHubState({ client, hubState, seedMetadata, debug });
    const persistedMetrics = await persistXoxnoHubMetrics({ client, entitySlug });

    if (persistedState.fallbackPrices.length) {
      console.log(
        `[xoxno] aggregator fallback priced ${persistedState.fallbackPrices.length} asset(s): ` +
          persistedState.fallbackPrices.map((p) => `${p.symbol}=${p.priceUsd} (feed ${p.ageSec}s old)`).join(', ')
      );
    }

    console.log({
      snapshotAt: persistedState.snapshotAt,
      entitySlug,
      hubId: hubState.hubId,
      appVersion: hubState.appVersion,
      latestLedger: hubState.latestLedger,
      reserveCount: persistedState.reserveCount,
      rpcCalls: hubState.readStats,
      callPlan: hubState.callPlan,
      fallbackPrices: persistedState.fallbackPrices.map((p) => p.symbol),
    });
    console.log(persistedMetrics);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
