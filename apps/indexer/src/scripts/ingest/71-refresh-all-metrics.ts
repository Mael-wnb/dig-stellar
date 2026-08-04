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

async function main() {
  const client = createPgClient();

  await client.connect();

  try {
    console.log('\n=== 1. Refresh reference prices ===');

    await runStep(
      'prices:reference',
      'src/scripts/ingest/62-price-reference-assets.ts'
    );

    console.log(
      '\n=== 2. Refresh derived Soroswap prices ==='
    );

    const soroswapPools =
      await getPoolsByVenue(
        client,
        'soroswap',
        'amm_pool'
      );

    for (const pool of soroswapPools) {
      await runStep(
        `prices:soroswap-derived:${pool.entitySlug}`,
        'src/scripts/ingest/63-price-soroswap-derived.ts',
        {
          ENTITY_SLUG: pool.entitySlug,
        }
      );
    }

    console.log(
      '\n=== 3. Refresh Blend pools + metrics ==='
    );

    const blendPools =
      await getPoolsByVenue(
        client,
        'blend',
        'lending_pool'
      );

    for (const pool of blendPools) {
      console.log(
        `\n--- Blend: ${pool.entitySlug} (${pool.contractAddress}) ---`
      );

      await runStep(
        `blend:${pool.entitySlug}`,
        'src/scripts/ingest/run-blend-pool-refresh.ts',
        {
          ENTITY_SLUG: pool.entitySlug,
          BLEND_POOL_ID: pool.contractAddress,
        }
      );
    }

    console.log(
      '\n=== 4. Refresh Soroswap pools + metrics ==='
    );

    for (const pool of soroswapPools) {
      console.log(
        `\n--- Soroswap: ${pool.entitySlug} (${pool.contractAddress}) ---`
      );

      await runStep(
        `soroswap:${pool.entitySlug}`,
        'src/scripts/ingest/run-soroswap-pair-refresh.ts',
        {
          ENTITY_SLUG: pool.entitySlug,
          SOROSWAP_PAIR_ID: pool.contractAddress,
        }
      );
    }

    console.log(
      '\n=== 5. Refresh Aquarius pools + metrics ==='
    );

    const aquariusPools =
      await getPoolsByVenue(
        client,
        'aquarius',
        'amm_pool'
      );

    for (const pool of aquariusPools) {
      console.log(
        `\n--- Aquarius: ${pool.entitySlug} (${pool.contractAddress}) ---`
      );

      try {
        await runStep(
          `aquarius:${pool.entitySlug}`,
          'src/scripts/ingest/run-aquarius-pool-refresh.ts',
          {
            ENTITY_SLUG: pool.entitySlug,
            AQUARIUS_POOL_ID: pool.contractAddress,
          }
        );
      } catch (error) {
        console.error(
          `Aquarius refresh failed for ${pool.entitySlug}`
        );

        console.error(error);
      }

      console.log(
        'Waiting 5 seconds before next Aquarius pool...'
      );

      await sleep(5000);
    }

    console.log(
      '\n=== 6. Refresh Stellar Native pools ==='
    );

    await runStep(
      'stellar-native',
      'src/scripts/ingest/run-stellar-native-refresh.ts'
    );

    console.log(
      '\n=== 6b. Refresh DeFindex vaults + metrics ==='
    );

    // Non-fatal: a DeFindex API hiccup must never abort the whole refresh
    // (mirrors the Aquarius / Allbridge / network-stats catch-and-log). Runs
    // after the price steps so the underlying (USDC/EURC) is priced, and before
    // step 7 so 70-protocol-persist-metrics folds DeFindex into protocol_metrics.
    const defindexVaults = await getPoolsByVenue(
      client,
      'defindex',
      'yield_vault'
    );

    for (const vault of defindexVaults) {
      console.log(
        `\n--- DeFindex: ${vault.entitySlug} (${vault.contractAddress}) ---`
      );

      try {
        await runStep(
          `defindex:${vault.entitySlug}`,
          'src/scripts/ingest/run-defindex-refresh.ts',
          {
            ENTITY_SLUG: vault.entitySlug,
            DEFINDEX_VAULT_ADDRESS: vault.contractAddress,
          }
        );
      } catch (error) {
        console.error(
          `DeFindex refresh failed for ${vault.entitySlug} (non-fatal)`
        );

        console.error(error);
      }
    }

    console.log(
      '\n=== 7. Refresh protocol metrics ==='
    );

    await runStep(
      'protocol-metrics',
      'src/scripts/ingest/70-protocol-persist-metrics.ts'
    );

    console.log(
      '\n=== 8. Refresh Allbridge bridge flows ==='
    );

    // Non-fatal: an Allbridge or RPC hiccup must never abort the whole refresh.
    // Mirrors the Aquarius / network-stats catch-and-log behaviour. Runs after
    // the price steps so amount_usd can use fresh prices. Single contract, so no
    // entity discovery query — the step runs unconditionally once per cycle.
    try {
      await runStep(
        'allbridge',
        'src/scripts/ingest/run-allbridge-bridge-refresh.ts'
      );
    } catch (error) {
      console.error('Allbridge bridge refresh failed (non-fatal)');
      console.error(error);
    }

    console.log(
      '\n=== 9. Refresh network stats ==='
    );

    // Non-fatal: external providers (CoinGecko / DefiLlama / stellar.expert /
    // Horizon) must never break the whole refresh job. Mirror the Aquarius
    // step's catch-and-log behaviour.
    try {
      await runStep(
        'network-stats',
        'src/scripts/ingest/73-network-stats-refresh.ts'
      );
    } catch (error) {
      console.error('Network stats refresh failed (non-fatal)');
      console.error(error);
    }

    console.log(
      '\n=== Refresh completed successfully ==='
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
