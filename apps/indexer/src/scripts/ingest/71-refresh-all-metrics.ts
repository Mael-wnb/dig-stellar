// apps/indexer/src/scripts/ingest/71-refresh-all-metrics.ts

import { spawn } from 'node:child_process';
import { createPgClient } from '../shared/db';

type PgClient = ReturnType<typeof createPgClient>;

type PoolRow = {
  slug: string;
  contract_address: string | null;
};

function runTsx(
  scriptPath: string,
  extraEnv?: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['tsx', scriptPath], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(extraEnv ?? {}),
      },
    });

    child.on('error', reject);

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Command failed (${code}): pnpm tsx ${scriptPath}`
          )
        );
      }
    });
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
  entityType: 'amm_pool' | 'lending_pool'
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

    await runTsx(
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
      await runTsx(
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

      await runTsx(
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

      await runTsx(
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
        await runTsx(
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

    await runTsx(
      'src/scripts/ingest/run-stellar-native-refresh.ts'
    );

    console.log(
      '\n=== 7. Refresh protocol metrics ==='
    );

    await runTsx(
      'src/scripts/ingest/70-protocol-persist-metrics.ts'
    );

    console.log(
      '\n=== 8. Refresh network stats ==='
    );

    // Non-fatal: external providers (CoinGecko / DefiLlama / stellar.expert /
    // Horizon) must never break the whole refresh job. Mirror the Aquarius
    // step's catch-and-log behaviour.
    try {
      await runTsx(
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