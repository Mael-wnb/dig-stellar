import { loadJson, saveJson, nowIso } from "./00-common";

function esc(str: string): string {
  return str.replace(/'/g, "''");
}

async function main() {
  const seed = await loadJson<any>("21-blend-v0-seed.json");

  const venue = seed?.venue;
  const entities = seed?.entities ?? [];
  const assets = seed?.assets ?? [];
  const entityAssets = seed?.entityAssets ?? [];

  const sqlParts: string[] = [];

  if (venue) {
    sqlParts.push(`
insert into venues (slug, name, venue_type, chain, metadata)
values ('${esc(venue.slug)}', '${esc(venue.name)}', '${esc(venue.venueType)}', '${esc(
      venue.chain
    )}', '${esc(JSON.stringify(venue.metadata ?? {}))}'::jsonb)
on conflict (slug) do nothing;
`.trim());
  }

  for (const entity of entities) {
    sqlParts.push(`
insert into entities (slug, name, entity_type, contract_address, status, metadata)
values (
  '${esc(entity.slug)}',
  '${esc(entity.name)}',
  '${esc(entity.entityType)}',
  '${esc(entity.contractAddress ?? "")}',
  '${esc(entity.status ?? "active")}',
  '${esc(JSON.stringify(entity.metadata ?? {}))}'::jsonb
)
on conflict (slug) do nothing;
`.trim());
  }

  for (const asset of assets) {
    sqlParts.push(`
insert into assets (chain, asset_type, contract_address, symbol, metadata)
values (
  '${esc(asset.chain)}',
  '${esc(asset.assetType)}',
  '${esc(asset.contractAddress)}',
  '${esc(asset.provisionalSymbol)}',
  '${esc(JSON.stringify({ source: asset.source, seenCount: asset.seenCount }))}'::jsonb
)
on conflict do nothing;
`.trim());
  }

  const output = {
    generatedAt: nowIso(),
    sqlPreview: sqlParts.join("\n\n"),
    entityAssets,
  };

  console.dir(
    {
      generatedAt: output.generatedAt,
      previewLength: output.sqlPreview.length,
      entityAssetsCount: entityAssets.length,
    },
    { depth: 6 }
  );

  await saveJson("24-blend-sql-preview.json", output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});