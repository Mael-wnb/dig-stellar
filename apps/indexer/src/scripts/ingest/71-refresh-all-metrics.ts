import { createPgClient } from '../shared/db';
import { spawn } from 'node:child_process';

function runTsx(scriptPath: string, extraEnv?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['tsx', scriptPath],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          ...(extraEnv ?? {}),
        },
      }
    );

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

async function getEntitySlugsByVenue(
  client: ReturnType<typeof createPgClient>,
  venueSlug: string
): Promise<string[]> {
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

  return res.rows.map((row: { slug: string }) => row.slug);
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

    console.log('\n=== 5. Refresh Aquarius pool metrics ===');
    const aquariusEntitySlugs = await getEntitySlugsByVenue(client, 'aquarius');

    for (const entitySlug of aquariusEntitySlugs) {
      await runTsx('src/scripts/ingest/69-aquarius-persist-pool-metrics.ts', {
        ENTITY_SLUG: entitySlug,
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