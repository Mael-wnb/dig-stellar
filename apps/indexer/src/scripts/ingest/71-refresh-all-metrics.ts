// src/scripts/ingest/71-refresh-all-metrics.ts
import { spawn } from 'node:child_process';
import { createPgClient } from '../shared/db';

type PgClient = ReturnType<typeof createPgClient>;

type EntitySlugRow = {
  slug: string;
};

type AquariusPoolRow = {
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

async function getEntitySlugsByVenue(client: PgClient, venueSlug: string): Promise<string[]> {
  const res = await client.query(
    `
    select e.slug
    from entities e
    join venues v on v.id = e.venue_id
    where v.slug = $1
      and e.entity_type = 'amm_pool'
    order by e.slug asc
    `,
    [venueSlug]
  );

  return (res.rows as EntitySlugRow[]).map((row) => row.slug);
}

async function getAquariusPools(
  client: PgClient
): Promise<Array<{ entitySlug: string; poolId: string }>> {
  const res = await client.query(
    `
    select
      e.slug,
      e.contract_address
    from entities e
    join venues v on v.id = e.venue_id
    where v.slug = 'aquarius'
      and e.entity_type = 'amm_pool'
    order by e.slug asc
    `
  );

  const rows = res.rows as AquariusPoolRow[];

  return rows.map((row) => {
    const poolId = row.contract_address?.trim() ?? '';

    if (!poolId) {
      throw new Error(`Missing contract_address for Aquarius entity "${row.slug}"`);
    }

    return {
      entitySlug: row.slug,
      poolId,
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
    const soroswapEntitySlugs = await getEntitySlugsByVenue(client, 'soroswap');

    for (const entitySlug of soroswapEntitySlugs) {
      await runTsx('src/scripts/ingest/63-price-soroswap-derived.ts', {
        ENTITY_SLUG: entitySlug,
      });
    }

    console.log('\n=== 3. Refresh Blend pool metrics ===');
    await runTsx('src/scripts/ingest/68-blend-persist-pool-metrics.ts');

    console.log('\n=== 4. Refresh Soroswap pool metrics ===');
    for (const entitySlug of soroswapEntitySlugs) {
      await runTsx('src/scripts/ingest/69-soroswap-persist-pool-metrics.ts', {
        ENTITY_SLUG: entitySlug,
      });
    }

    console.log('\n=== 5. Refresh Aquarius pools + metrics ===');
    const aquariusPools = await getAquariusPools(client);

    for (const pool of aquariusPools) {
      const env = {
        ENTITY_SLUG: pool.entitySlug,
        AQUARIUS_POOL_ID: pool.poolId,
      };

      console.log(`\n--- Aquarius: ${pool.entitySlug} (${pool.poolId}) ---`);

      await runTsx('src/scripts/discovery/55-aquarius-active-pool-probe.ts', env);
      await runTsx('src/scripts/discovery/56-aquarius-active-pool-assets-resolve.ts', env);
      await runTsx('src/scripts/discovery/57-aquarius-active-pool-db-shape.ts', env);
      await runTsx('src/scripts/discovery/50-aquarius-pool-events.ts', env);
      await runTsx('src/scripts/discovery/58-aquarius-active-pool-events-normalized.ts', env);
      await runTsx('src/scripts/discovery/59-aquarius-final-registry.ts', env);
      await runTsx('src/scripts/ingest/aquarius-insert-events.ts', env);
      await runTsx('src/scripts/ingest/69-aquarius-persist-pool-metrics.ts', env);
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