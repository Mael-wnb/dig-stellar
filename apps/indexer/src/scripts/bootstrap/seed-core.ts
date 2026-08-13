// apps/indexer/src/scripts/bootstrap/seed-core.ts
//
// E4 (Lot E — T3-D3): seed the vetted indexing perimeter on a fresh database
// from the COMMITTED registries/core-registry.json (see registry-export.ts for
// provenance). This is THE quickstart bootstrap: one command instead of the
// legacy per-protocol upserts, whose tmp/discovery registry inputs no longer
// exist. Idempotent (same conflict targets as the legacy bootstraps): safe to
// re-run, safe on a DB that already has the perimeter.
//
//   pnpm -C apps/indexer bootstrap:core
//
// stellar-native: only its venue row is seeded — its pool entities are
// discovered and upserted by run-stellar-native-refresh on each refresh.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPgClient } from '../shared/db';
import { nowIso } from '../discovery/00-common';

const REGISTRY_FILE = path.resolve(
  __dirname,
  'registries',
  'core-registry.json'
);

type Registry = {
  generatedAt: string;
  venues: Array<{
    slug: string;
    name: string;
    chain: string;
    venue_type: string;
    logo_url: string | null;
    metadata: unknown;
  }>;
  entities: Array<{
    venue_slug: string;
    slug: string;
    name: string;
    entity_type: string;
    contract_address: string | null;
    is_active: boolean;
    metadata: unknown;
  }>;
  assets: Array<{
    chain: string;
    contract_address: string;
    asset_type: string;
    symbol: string | null;
    name: string | null;
    decimals: number | null;
    logo_url: string | null;
    metadata: unknown;
  }>;
  entityAssets: Array<{
    entity_slug: string;
    asset_contract_address: string;
    role: string;
    metadata: unknown;
  }>;
};

async function main() {
  const raw = await readFile(REGISTRY_FILE, 'utf-8').catch(() => null);
  if (!raw) {
    throw new Error(`Missing committed registry: ${REGISTRY_FILE}`);
  }
  const registry = JSON.parse(raw) as Registry;

  const client = createPgClient();
  await client.connect();

  try {
    await client.query('begin');

    const venueIds = new Map<string, string>();
    for (const v of registry.venues) {
      const res = await client.query(
        `
        insert into venues (slug, name, chain, venue_type, logo_url, metadata)
        values ($1, $2, $3, $4, $5, $6::jsonb)
        on conflict (slug)
        do update set
          name = excluded.name,
          chain = excluded.chain,
          venue_type = excluded.venue_type,
          logo_url = excluded.logo_url,
          metadata = excluded.metadata,
          updated_at = now()
        returning id
        `,
        [v.slug, v.name, v.chain, v.venue_type, v.logo_url, JSON.stringify(v.metadata ?? {})]
      );
      venueIds.set(v.slug, res.rows[0].id as string);
    }

    const assetIds = new Map<string, string>();
    for (const a of registry.assets) {
      const res = await client.query(
        `
        insert into assets (chain, contract_address, asset_type, symbol, name, decimals, logo_url, metadata)
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        on conflict (contract_address)
        do update set
          chain = excluded.chain,
          asset_type = excluded.asset_type,
          symbol = excluded.symbol,
          name = excluded.name,
          decimals = excluded.decimals,
          logo_url = excluded.logo_url,
          metadata = excluded.metadata,
          updated_at = now()
        returning id
        `,
        [a.chain, a.contract_address, a.asset_type, a.symbol, a.name, a.decimals, a.logo_url, JSON.stringify(a.metadata ?? {})]
      );
      assetIds.set(a.contract_address, res.rows[0].id as string);
    }

    const entityIds = new Map<string, string>();
    for (const e of registry.entities) {
      const venueId = venueIds.get(e.venue_slug);
      if (!venueId) {
        throw new Error(`entity ${e.slug}: unknown venue ${e.venue_slug}`);
      }
      const res = await client.query(
        `
        insert into entities (venue_id, slug, name, entity_type, contract_address, metadata, is_active)
        values ($1, $2, $3, $4, $5, $6::jsonb, $7)
        on conflict (slug)
        do update set
          venue_id = excluded.venue_id,
          name = excluded.name,
          entity_type = excluded.entity_type,
          contract_address = excluded.contract_address,
          metadata = excluded.metadata,
          is_active = excluded.is_active,
          updated_at = now()
        returning id
        `,
        [venueId, e.slug, e.name, e.entity_type, e.contract_address, JSON.stringify(e.metadata ?? {}), e.is_active]
      );
      entityIds.set(e.slug, res.rows[0].id as string);
    }

    let linkCount = 0;
    for (const link of registry.entityAssets) {
      const entityId = entityIds.get(link.entity_slug);
      const assetId = assetIds.get(link.asset_contract_address);
      if (!entityId || !assetId) {
        throw new Error(
          `entity_assets link ${link.entity_slug} -> ${link.asset_contract_address}: unresolved reference`
        );
      }
      await client.query(
        `
        insert into entity_assets (entity_id, asset_id, role, metadata)
        values ($1, $2, $3, $4::jsonb)
        on conflict (entity_id, asset_id, role)
        do update set
          metadata = excluded.metadata
        `,
        [entityId, assetId, link.role, JSON.stringify(link.metadata ?? {})]
      );
      linkCount += 1;
    }

    // reserve_snapshots are no longer seeded: since the frozen-TVL hotfix
    // (docs/hotfix-frozen-amm-reserves.md) every venue writes them on the live
    // refresh path, so the first `job:refresh` produces current rows itself.

    await client.query('commit');

    console.log({
      completedAt: nowIso(),
      registryGeneratedAt: registry.generatedAt,
      venues: venueIds.size,
      entities: entityIds.size,
      assets: assetIds.size,
      entityAssets: linkCount,
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
