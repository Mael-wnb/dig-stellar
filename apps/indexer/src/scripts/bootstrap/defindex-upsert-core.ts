// apps/indexer/src/scripts/bootstrap/defindex-upsert-core.ts
//
// Bootstrap DeFindex into the raw SQL v1 product pipeline (venues / entities /
// assets / entity_assets), mirroring aquarius-upsert-core.ts. This is what makes
// DeFindex a real product protocol (read by /v1/*), NOT the legacy Prisma
// scaffold in src/run-defindex.ts (which writes Protocol/Venue/Snapshot that the
// product does not read).
//
// Vault selection (T3-D1) — enumerated from DeFindex's own API on 2026-08-02 via
//   GET https://api.defindex.io/vault/discover?network=mainnet  (Bearer auth),
// cross-checked with GET /vault/{address}. Picked for non-trivial mainnet TVL and
// a real, non-zero 7-day APY, with one EURC vault for asset diversity. Strategies
// are Blend auto-compound (fixed / YieldBlox). TVL/APY below are seed-time
// evidence only; the live values are refreshed by run-defindex-refresh.ts.
//
//   MERU  (USDC)  CCA2ZJP5BVRXYTQH4FAGHCAUMRYCXVC4CRYC2NXHWMR7TIVX36U7F5HR
//                 "DeFindex-Vault-Meru"       ≈ $17.9M   apy ≈ 7.1–7.9%
//   BEANS (USDC)  CBNKCU3HGFKHFOF7JTGXQCNKE3G3DXS5RDBQUKQMIIECYKXPIOUGB2S3
//                 "DeFindex-Vault-BeansUsdcVault" ≈ $506k apy ≈ 6.99%
//   BEANS (EURC)  CAIZ3NMNPEN5SQISJV7PD2YY6NI6DIPFA4PCRUBOGDE4I7A3DXDLK5OI
//                 "DeFindex-Vault-BeansEurcVault" ≈ €172.8k apy ≈ 5.37%
//
// Underlying assets are the mainnet Circle SACs (already present + priced by
// step 62): USDC:GA5ZSEJY… and EURC:GDHU6WRG… (7 decimals). We upsert them
// defensively so this bootstrap is self-contained.

import { nowIso } from '../discovery/00-common';
import { createPgClient } from '../shared/db';

const CHAIN = 'stellar-mainnet';

type UnderlyingAsset = {
  contractAddress: string; // Stellar Asset Contract (SAC) id
  symbol: string;
  name: string;
  decimals: number;
};

const USDC: UnderlyingAsset = {
  contractAddress: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
  symbol: 'USDC',
  name: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  decimals: 7,
};

const EURC: UnderlyingAsset = {
  contractAddress: 'CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV',
  symbol: 'EURC',
  name: 'EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2',
  decimals: 7,
};

type VaultSeed = {
  entitySlug: string;
  name: string;
  vaultSymbol: string;
  vaultAddress: string;
  underlying: UnderlyingAsset;
  seedEvidence: Record<string, unknown>;
};

const VAULTS: VaultSeed[] = [
  {
    entitySlug: 'defindex-meru-usdc',
    name: 'DeFindex Meru (USDC)',
    vaultSymbol: 'MERU',
    vaultAddress: 'CCA2ZJP5BVRXYTQH4FAGHCAUMRYCXVC4CRYC2NXHWMR7TIVX36U7F5HR',
    underlying: USDC,
    seedEvidence: {
      discoveredTvlUsd: 17_900_000,
      discoveredApyPct: 7.87,
      strategies: [
        'USDC Autocompound Blend Fixed',
        'USDC Autocompound Blend YieldBlox',
      ],
    },
  },
  {
    entitySlug: 'defindex-beans-usdc',
    name: 'DeFindex Beans (USDC)',
    vaultSymbol: 'BNSUSDC',
    vaultAddress: 'CBNKCU3HGFKHFOF7JTGXQCNKE3G3DXS5RDBQUKQMIIECYKXPIOUGB2S3',
    underlying: USDC,
    seedEvidence: {
      discoveredTvlUsd: 506_000,
      discoveredApyPct: 6.99,
      strategies: ['usdc_blend_autocompound_fixed'],
    },
  },
  {
    entitySlug: 'defindex-beans-eurc',
    name: 'DeFindex Beans (EURC)',
    vaultSymbol: 'BNSEURC',
    vaultAddress: 'CAIZ3NMNPEN5SQISJV7PD2YY6NI6DIPFA4PCRUBOGDE4I7A3DXDLK5OI',
    underlying: EURC,
    seedEvidence: {
      discoveredEurcAmount: 172_800,
      discoveredApyPct: 5.37,
      strategies: ['eurc_blend_autocompound_fixed'],
    },
  },
];

async function upsertAsset(
  client: ReturnType<typeof createPgClient>,
  asset: UnderlyingAsset
): Promise<string> {
  const res = await client.query(
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
      updated_at = now()
    returning id
    `,
    [
      CHAIN,
      asset.contractAddress,
      'soroban_token',
      asset.symbol,
      asset.name,
      asset.decimals,
      JSON.stringify({ source: 'defindex_bootstrap' }),
    ]
  );

  return res.rows[0].id as string;
}

async function main() {
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
        'defindex',
        'DeFindex',
        CHAIN,
        'vault',
        JSON.stringify({
          source: 'defindex_bootstrap',
          category: 'yield',
          enumeration: 'GET /vault/discover?network=mainnet (2026-08-02)',
        }),
      ]
    );

    const venueId = venueRes.rows[0].id as string;

    let entityCount = 0;

    for (const vault of VAULTS) {
      const assetId = await upsertAsset(client, vault.underlying);

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
          vault.entitySlug,
          vault.name,
          'yield_vault',
          vault.vaultAddress,
          JSON.stringify({
            source: 'defindex_bootstrap',
            vaultSymbol: vault.vaultSymbol,
            underlyingAsset: vault.underlying.contractAddress,
            underlyingSymbol: vault.underlying.symbol,
            seedEvidence: vault.seedEvidence,
          }),
        ]
      );

      const entityId = entityRes.rows[0].id as string;

      await client.query(
        `
        insert into entity_assets (entity_id, asset_id, role, metadata)
        values ($1, $2, $3, $4::jsonb)
        on conflict (entity_id, asset_id, role)
        do update set metadata = excluded.metadata
        `,
        [
          entityId,
          assetId,
          'underlying',
          JSON.stringify({ source: 'defindex_bootstrap' }),
        ]
      );

      entityCount += 1;
    }

    await client.query('commit');

    console.log({
      completedAt: nowIso(),
      venueId,
      venueSlug: 'defindex',
      entityCount,
      vaults: VAULTS.map((v) => v.entitySlug),
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
