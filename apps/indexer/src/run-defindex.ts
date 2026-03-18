import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function fetchVaults(api: string) {
  // Endpoint typique (à adapter si besoin)
  const res = await fetch(`${api}/vaults`);

  if (!res.ok) {
    throw new Error(`DeFindex API failed: ${res.status}`);
  }

  return res.json();
}

async function main() {
  const api = required('DEFINDEX_API_URL');

  // 1) Fetch raw data
  const raw = await fetchVaults(api);

  console.log('DeFindex raw:', JSON.stringify(raw, null, 2));

  const vaults = raw?.data ?? raw ?? [];

  // 2) Upsert protocol
  const protocol = await prisma.protocol.upsert({
    where: { key: 'defindex' },
    update: { name: 'DeFindex', category: 'yield' },
    create: { key: 'defindex', name: 'DeFindex', category: 'yield' },
  });

  for (const v of vaults) {
    const vaultId = v.id || v.address || v.vaultAddress;

    if (!vaultId) continue;

    const venueKey = `defindex:vault:${vaultId}`;

    // 3) Venue
    const venue = await prisma.venue.upsert({
      where: { key: venueKey },
      update: {
        protocolId: protocol.id,
        type: 'vault',
        label: v.name || 'DeFindex Vault',
        meta: {
          raw: v,
        },
      },
      create: {
        key: venueKey,
        protocolId: protocol.id,
        type: 'vault',
        label: v.name || 'DeFindex Vault',
        meta: {
          raw: v,
        },
      },
    });

    // 4) Snapshot
    await prisma.snapshot.create({
      data: {
        venueId: venue.id,
        ts: new Date(),

        // Mapping minimal
        apy: v.apy ?? v.yield ?? null,
        tvl: v.tvl ?? v.totalValueLocked ?? null,

        data: {
          source: 'defindex',
          vaultId,
          raw: v,
        },
      },
    });
  }

  console.log(`DeFindex snapshots written: ${vaults.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());