// src/scripts/ingest/71-refresh-all-metrics.ts
import { spawn } from 'node:child_process';
import { createPgClient } from '../shared/db';

type PgClient = ReturnType<typeof createPgClient>;

type AmmPoolRow = {
  slug: string;
  contract_address: string | null;
};

function runTsx(scriptPath: string, extraEnv?: Record<string, string>): Promise<void> {
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
        reject(new Error(`Command failed (${code}): pnpm tsx ${scriptPath}`));
      }
    });
  });
}

async function getAmmPoolsByVenue(
  client: PgClient,
  venueSlug: string
): Promise<Array<{ entitySlug: string; contractAddress: string }>> {
  const res = await client.query(
    `
    select
      e.slug,
      e.contract_address
    from entities e
    join venues v on v.id = e.venue_id
    where v.slug = $1
      and e.entity_type = 'amm_pool'
    order by e.slug asc
    `,
    [venueSlug]
  );

  const rows = res.rows as AmmPoolRow[];

  return rows.map((row) => {
    const contractAddress = row.contract_address?.trim() ?? '';

    if (!contractAddress) {
      throw new Error(`Missing contract_address for ${venueSlug} entity "${row.slug}"`);
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
    await runTsx('src/scripts/ingest/62-price-reference-assets.ts');

    console.log('\n=== 2. Refresh derived Soroswap prices ===');
    const soroswapPools = await getAmmPoolsByVenue(client, 'soroswap');

    for (const pool of soroswapPools) {
      await runTsx('src/scripts/ingest/63-price-soroswap-derived.ts', {
        ENTITY_SLUG: pool.entitySlug,
      });
    }

    console.log('\n=== 3. Refresh Blend pool metrics ===');
    await runTsx('src/scripts/ingest/68-blend-persist-pool-metrics.ts');

    console.log('\n=== 4. Refresh Soroswap pools + metrics ===');
    for (const pool of soroswapPools) {
      console.log(`\n--- Soroswap: ${pool.entitySlug} (${pool.contractAddress}) ---`);

      await runTsx('src/scripts/ingest/run-soroswap-pair-refresh.ts', {
        ENTITY_SLUG: pool.entitySlug,
        SOROSWAP_PAIR_ID: pool.contractAddress,
      });
    }

    console.log('\n=== 5. Refresh Aquarius pools + metrics ===');
    const aquariusPools = await getAmmPoolsByVenue(client, 'aquarius');

    for (const pool of aquariusPools) {
      console.log(`\n--- Aquarius: ${pool.entitySlug} (${pool.contractAddress}) ---`);

      await runTsx('src/scripts/ingest/run-aquarius-pool-refresh.ts', {
        ENTITY_SLUG: pool.entitySlug,
        AQUARIUS_POOL_ID: pool.contractAddress,
      });
    }

    console.log('\n=== 6. Refresh protocol metrics ===');
    await runTsx('src/scripts/ingest/70-protocol-persist-metrics.ts');

    console.log('\n=== Refresh completed successfully ===');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});