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

  const rows = res.rows as AmmPoolRow[];

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
    const pools = await getAquariusPools(client);

    console.log('\n=== Aquarius refresh ===');

    for (const pool of pools) {
      console.log(`\n--- Aquarius: ${pool.entitySlug} (${pool.poolId}) ---`);

      await runTsx('src/scripts/ingest/run-aquarius-pool-refresh.ts', {
        ENTITY_SLUG: pool.entitySlug,
        AQUARIUS_POOL_ID: pool.poolId,
      });
    }

    console.log('\n=== Aquarius refresh completed successfully ===');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});