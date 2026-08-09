// apps/indexer/src/scripts/ingest/71-refresh-all-metrics.ts

import { createPgClient } from '../shared/db';
import { runTsxWithRetry } from '../shared/retry';

type PgClient = ReturnType<typeof createPgClient>;

type PoolRow = {
  slug: string;
  contract_address: string | null;
};

// Standardized exponential-backoff retry for every step (T3-D1). One mechanism:
// 3 attempts, 5s → 20s backoff + jitter, each retry logged with the step label.
// Per-protocol-entity steps retry per entity. Steps that must stay non-fatal
// (Aquarius / DeFindex / Allbridge / network-stats) keep their try/catch — the
// retries happen INSIDE, catch-and-log is the last resort.
function runStep(
  label: string,
  scriptPath: string,
  env?: Record<string, string>
): Promise<void> {
  return runTsxWithRetry(scriptPath, {
    env,
    label,
    attempts: 3,
    baseDelayMs: 5000,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

// ── Per-step outcome tracking (T3 incident fix) ──────────────────────────────
// Every step is non-fatal: retries happen INSIDE runStep, and a residual failure
// is caught, logged and recorded here instead of propagating — so one flaky
// protocol can no longer skip the steps after it (protocol metrics, native,
// defindex, allbridge, network-stats). The job still exits 1 when ANY step
// failed, so the cron log stays red on real problems.
type StepStatus = 'SUCCESS' | 'FAILED';
type StepResult = { name: string; status: StepStatus; message?: string; durationMs: number };

const stepResults: StepResult[] = [];

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Elapsed seconds, one decimal (e.g. "42.3s") from a Date.now() delta.
function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// Run a single step, recording SUCCESS/FAILED + elapsed time. Never throws.
async function track(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    stepResults.push({ name, status: 'SUCCESS', durationMs: Date.now() - start });
  } catch (error) {
    const message = toMessage(error);
    console.error(`[refresh] step "${name}" FAILED (non-fatal): ${message}`);
    console.error(error);
    stepResults.push({ name, status: 'FAILED', message, durationMs: Date.now() - start });
  }
}

// Run a per-entity loop as ONE summary step: catch per entity so a single bad
// entity neither aborts its siblings nor the rest of the job; the step is FAILED
// iff at least one entity failed. Never throws.
async function trackEach<T>(
  name: string,
  items: T[],
  label: (item: T) => string,
  fn: (item: T) => Promise<void>,
  betweenMs = 0
): Promise<void> {
  const start = Date.now();
  const failures: string[] = [];

  for (const item of items) {
    try {
      await fn(item);
    } catch (error) {
      const message = toMessage(error);
      console.error(
        `[refresh] ${name}:${label(item)} FAILED (non-fatal): ${message}`
      );
      console.error(error);
      failures.push(`${label(item)}: ${message}`);
    }

    if (betweenMs > 0) {
      await sleep(betweenMs);
    }
  }

  const durationMs = Date.now() - start;

  if (failures.length) {
    stepResults.push({
      name,
      status: 'FAILED',
      message: `${failures.length}/${items.length} failed — ${failures.join('; ')}`,
      durationMs,
    });
  } else {
    stepResults.push({ name, status: 'SUCCESS', durationMs });
  }
}

// Entity discovery is itself I/O (a DB query) that can fail. Keep it non-fatal:
// on failure record the step and return [] so dependent loops simply no-op.
async function safeDiscover(
  name: string,
  client: PgClient,
  venueSlug: string,
  entityType: 'amm_pool' | 'lending_pool' | 'yield_vault'
): Promise<Array<{ entitySlug: string; contractAddress: string }>> {
  const start = Date.now();
  try {
    return await getPoolsByVenue(client, venueSlug, entityType);
  } catch (error) {
    const message = toMessage(error);
    console.error(
      `[refresh] discovery "${name}" FAILED (non-fatal): ${message}`
    );
    console.error(error);
    stepResults.push({ name, status: 'FAILED', message, durationMs: Date.now() - start });
    return [];
  }
}

function printSummary(totalMs: number): boolean {
  console.log('\n=== Refresh step summary ===');

  stepResults.forEach((result, index) => {
    const line =
      result.status === 'FAILED'
        ? `FAILED (${result.message ?? 'unknown error'}) in ${secs(result.durationMs)}`
        : `SUCCESS in ${secs(result.durationMs)}`;

    console.log(`step ${index + 1} ${result.name}: ${line}`);
  });

  const failed = stepResults.filter((r) => r.status === 'FAILED');

  console.log(
    `\n${failed.length === 0 ? 'All steps succeeded' : `${failed.length} step(s) FAILED`} (${stepResults.length} total)`
  );
  console.log(`Total job duration: ${secs(totalMs)}`);

  return failed.length === 0;
}

async function getPoolsByVenue(
  client: PgClient,
  venueSlug: string,
  entityType: 'amm_pool' | 'lending_pool' | 'yield_vault'
): Promise<Array<{ entitySlug: string; contractAddress: string }>> {
  // Only refresh entities that are still active. Pools whose Soroban contract
  // has been archived (TTL expired) or delisted return 404 on every state read
  // and would abort the whole refresh; mark them is_active = false in the DB
  // and they are skipped here without touching code.
  const res = await client.query(
    `
    select
      e.slug,
      e.contract_address
    from entities e
    join venues v
      on v.id = e.venue_id
    where v.slug = $1
      and e.entity_type = $2
      and e.is_active = true
    order by e.slug asc
    `,
    [venueSlug, entityType]
  );

  const rows = res.rows as PoolRow[];

  return rows.map((row) => {
    const contractAddress =
      row.contract_address?.trim() ?? '';

    if (!contractAddress) {
      throw new Error(
        `Missing contract_address for ${venueSlug} entity "${row.slug}"`
      );
    }

    return {
      entitySlug: row.slug,
      contractAddress,
    };
  });
}

async function main(): Promise<boolean> {
  const jobStart = Date.now();
  const client = createPgClient();

  await client.connect();

  try {
    // Discover once up front; each discovery is non-fatal and returns [] on
    // failure so dependent steps simply no-op instead of aborting the run.
    const soroswapPools = await safeDiscover('discover:soroswap', client, 'soroswap', 'amm_pool');
    const blendPools = await safeDiscover('discover:blend', client, 'blend', 'lending_pool');
    const aquariusPools = await safeDiscover('discover:aquarius', client, 'aquarius', 'amm_pool');
    const defindexVaults = await safeDiscover('discover:defindex', client, 'defindex', 'yield_vault');

    console.log('\n=== 1. Refresh reference prices ===');

    await track('prices:reference', () =>
      runStep('prices:reference', 'src/scripts/ingest/62-price-reference-assets.ts')
    );

    console.log('\n=== 2. Refresh derived Soroswap prices ===');

    await trackEach(
      'prices:soroswap-derived',
      soroswapPools,
      (pool) => pool.entitySlug,
      (pool) =>
        runStep(
          `prices:soroswap-derived:${pool.entitySlug}`,
          'src/scripts/ingest/63-price-soroswap-derived.ts',
          { ENTITY_SLUG: pool.entitySlug }
        )
    );

    console.log('\n=== 3. Refresh Blend pools + metrics ===');

    await trackEach(
      'blend',
      blendPools,
      (pool) => pool.entitySlug,
      (pool) => {
        console.log(`\n--- Blend: ${pool.entitySlug} (${pool.contractAddress}) ---`);
        return runStep(`blend:${pool.entitySlug}`, 'src/scripts/ingest/run-blend-pool-refresh.ts', {
          ENTITY_SLUG: pool.entitySlug,
          BLEND_POOL_ID: pool.contractAddress,
        });
      }
    );

    console.log('\n=== 4. Refresh Soroswap pools + metrics ===');

    await trackEach(
      'soroswap',
      soroswapPools,
      (pool) => pool.entitySlug,
      (pool) => {
        console.log(`\n--- Soroswap: ${pool.entitySlug} (${pool.contractAddress}) ---`);
        return runStep(
          `soroswap:${pool.entitySlug}`,
          'src/scripts/ingest/run-soroswap-pair-refresh.ts',
          { ENTITY_SLUG: pool.entitySlug, SOROSWAP_PAIR_ID: pool.contractAddress }
        );
      }
    );

    console.log('\n=== 5. Refresh Aquarius pools + metrics ===');

    await trackEach(
      'aquarius',
      aquariusPools,
      (pool) => pool.entitySlug,
      (pool) => {
        console.log(`\n--- Aquarius: ${pool.entitySlug} (${pool.contractAddress}) ---`);
        return runStep(
          `aquarius:${pool.entitySlug}`,
          'src/scripts/ingest/run-aquarius-pool-refresh.ts',
          { ENTITY_SLUG: pool.entitySlug, AQUARIUS_POOL_ID: pool.contractAddress }
        );
      },
      // Preserve the inter-pool spacing that was here before.
      5000
    );

    console.log('\n=== 6. Refresh Stellar Native pools ===');

    await track('stellar-native', () =>
      runStep('stellar-native', 'src/scripts/ingest/run-stellar-native-refresh.ts')
    );

    console.log('\n=== 6b. Refresh DeFindex vaults + metrics ===');

    // Runs after the price steps so the underlying (USDC/EURC) is priced, and
    // before protocol metrics so 70-protocol-persist-metrics folds DeFindex in.
    await trackEach(
      'defindex',
      defindexVaults,
      (vault) => vault.entitySlug,
      (vault) => {
        console.log(`\n--- DeFindex: ${vault.entitySlug} (${vault.contractAddress}) ---`);
        return runStep(`defindex:${vault.entitySlug}`, 'src/scripts/ingest/run-defindex-refresh.ts', {
          ENTITY_SLUG: vault.entitySlug,
          DEFINDEX_VAULT_ADDRESS: vault.contractAddress,
        });
      }
    );

    console.log('\n=== 7. Refresh protocol metrics ===');

    // ALWAYS runs — folds every protocol's pool_metrics_latest into
    // protocol_metrics_latest, so it must not be gated behind an earlier step.
    await track('protocol-metrics', () =>
      runStep('protocol-metrics', 'src/scripts/ingest/70-protocol-persist-metrics.ts')
    );

    console.log('\n=== 8. Refresh Allbridge bridge flows ===');

    await track('allbridge', () =>
      runStep('allbridge', 'src/scripts/ingest/run-allbridge-bridge-refresh.ts')
    );

    console.log('\n=== 9. Refresh network stats ===');

    await track('network-stats', () =>
      runStep('network-stats', 'src/scripts/ingest/73-network-stats-refresh.ts')
    );
  } finally {
    await client.end();
  }

  // Exit code is derived from the summary: green when every step succeeded,
  // red when any step failed — but only AFTER all steps have run.
  return printSummary(Date.now() - jobStart);
}

main()
  .then((ok) => {
    console.log(
      ok
        ? '\n=== Refresh completed successfully ==='
        : '\n=== Refresh completed WITH FAILURES ==='
    );
    process.exit(ok ? 0 : 1);
  })
  .catch((err) => {
    // Only reached by a truly unexpected error (e.g. DB connect) outside the
    // per-step guards — those remain fatal by design.
    console.error(err);
    process.exit(1);
  });
