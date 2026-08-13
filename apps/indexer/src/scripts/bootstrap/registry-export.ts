// apps/indexer/src/scripts/bootstrap/registry-export.ts
//
// E4 (Lot E — T3-D3): regenerate the COMMITTED core registry from the live DB.
//
// Why: the original per-protocol bootstraps read `*-final-registry.json` files
// from gitignored tmp/discovery — those artifacts no longer exist anywhere, so
// a fresh clone could not seed the indexing perimeter (found by the E4
// fresh-clone proof). The DB of the running deployment is the one authoritative
// record of the vetted perimeter, so this script exports it into
// src/scripts/bootstrap/registries/core-registry.json (COMMITTED), and
// seed-core.ts replays it on a fresh database.
//
// Scope: all venues; all entities EXCEPT stellar-native's (its ~60 pool
// entities are discovered and upserted by run-stellar-native-refresh itself —
// only the venue row must pre-exist); all assets; entity_assets links for the
// exported entities. Natural keys only (slugs / contract addresses) — UUIDs
// are environment-specific and re-minted on seed.
//
// Run against the source deployment, then commit the JSON:
//   pnpm -C apps/indexer exec tsx src/scripts/bootstrap/registry-export.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPgClient } from '../shared/db';
import { nowIso } from '../discovery/00-common';

const OUT_FILE = path.resolve(
  __dirname,
  'registries',
  'core-registry.json'
);

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    const venues = (
      await client.query(`
        select slug, name, chain, venue_type, logo_url, metadata
        from venues
        order by slug asc
      `)
    ).rows;

    const entities = (
      await client.query(`
        select
          v.slug as venue_slug,
          e.slug,
          e.name,
          e.entity_type,
          e.contract_address,
          e.is_active,
          e.metadata
        from entities e
        join venues v on v.id = e.venue_id
        where v.slug <> 'stellar-native'
        order by v.slug asc, e.slug asc
      `)
    ).rows;

    const assets = (
      await client.query(`
        select chain, contract_address, asset_type, symbol, name, decimals, logo_url, metadata
        from assets
        order by symbol asc, contract_address asc
      `)
    ).rows;

    const entityAssets = (
      await client.query(`
        select
          e.slug as entity_slug,
          a.contract_address as asset_contract_address,
          ea.role,
          ea.metadata
        from entity_assets ea
        join entities e on e.id = ea.entity_id
        join assets a on a.id = ea.asset_id
        join venues v on v.id = e.venue_id
        where v.slug <> 'stellar-native'
        order by e.slug asc, ea.role asc, a.contract_address asc
      `)
    ).rows;

    // reserve_snapshots are deliberately NOT exported: every venue that needs
    // them now writes them on the live refresh path (Blend, stellar-native,
    // defindex always did; Soroswap + Aquarius since the frozen-TVL hotfix —
    // see docs/hotfix-frozen-amm-reserves.md), so a fresh clone's first
    // `job:refresh` produces current rows by itself. Seed only what the first
    // refresh cannot produce.

    const registry = {
      generatedAt: nowIso(),
      source: 'registry-export.ts (live DB snapshot of the vetted perimeter)',
      venues,
      entities,
      assets,
      entityAssets,
    };

    await mkdir(path.dirname(OUT_FILE), { recursive: true });
    await writeFile(OUT_FILE, `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');

    console.log({
      completedAt: nowIso(),
      outFile: OUT_FILE,
      venues: venues.length,
      entities: entities.length,
      assets: assets.length,
      entityAssets: entityAssets.length,
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
