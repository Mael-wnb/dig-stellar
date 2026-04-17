// apps/indexer/src/scripts/bootstrap/blend-upsert-core.ts
import { loadJson, nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';

async function main() {
  const registry = await loadJson<any>('41-blend-final-registry.json');
  if (!registry) {
    throw new Error('Missing 41-blend-final-registry.json');
  }

  const client = createPgClient();
  await client.connect();

  try {
    await client.query('begin');

    const venueRes = await client.query(
      `
      insert into venues (slug, name, chain, venue_type, metadata)
      values ($1, $2, $3, $4, $5::jsonb)
      on conflict (slug)
      do update set
        name = excluded.name,
        chain = excluded.chain,
        venue_type = excluded.venue_type,
        metadata = excluded.metadata,
        updated_at = now()
      returning id
      `,
      [
        registry.venue.slug,
        registry.venue.name,
        registry.venue.chain,
        registry.venue.venueType,
        JSON.stringify({
          source: 'blend_final_registry',
          generatedAt: registry.generatedAt,
        }),
      ]
    );

    const venueId = venueRes.rows[0].id as string;

    const entityRes = await client.query(
      `
      insert into entities (venue_id, slug, name, entity_type, contract_address, metadata, is_active)
      values ($1, $2, $3, $4, $5, $6::jsonb, true)
      on conflict (slug)
      do update set
        venue_id = excluded.venue_id,
        name = excluded.name,
        entity_type = excluded.entity_type,
        contract_address = excluded.contract_address,
        metadata = excluded.metadata,
        updated_at = now()
      returning id
      `,
      [
        venueId,
        registry.pool.entitySlug,
        registry.pool.name,
        'lending_pool',
        registry.pool.poolId,
        JSON.stringify({
          reserveCount: registry.pool.reserveCount,
          source: 'blend_final_registry',
        }),
      ]
    );

    const entityId = entityRes.rows[0].id as string;

    let assetCount = 0;

    for (const reserve of registry.reserves ?? []) {
      const assetRes = await client.query(
        `
        insert into assets (chain, contract_address, asset_type, symbol, name, decimals, metadata)
        values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        on conflict (contract_address)
        do update set
          chain = excluded.chain,
          asset_type = excluded.asset_type,
          symbol = excluded.symbol,
          name = excluded.name,
          decimals = excluded.decimals,
          metadata = excluded.metadata,
          updated_at = now()
        returning id
        `,
        [
          registry.venue.chain,
          reserve.assetId,
          'soroban_token',
          reserve.symbol,
          reserve.name,
          reserve.decimals,
          JSON.stringify({
            source: 'blend_reserve_assets',
            generatedAt: registry.generatedAt,
          }),
        ]
      );

      const assetId = assetRes.rows[0].id as string;

      await client.query(
        `
        insert into entity_assets (entity_id, asset_id, role, metadata)
        values ($1, $2, $3, $4::jsonb)
        on conflict (entity_id, asset_id, role)
        do update set
          metadata = excluded.metadata
        `,
        [
          entityId,
          assetId,
          'reserve',
          JSON.stringify({
            source: 'blend_final_registry',
          }),
        ]
      );

      assetCount += 1;
    }

    await client.query('commit');

    console.log({
      completedAt: nowIso(),
      venueId,
      entityId,
      assetCount,
    });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});