import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const horizon = required('HORIZON_URL');

  // 1) Horizon root: reliable latest ledger
  const rootRes = await fetch(`${horizon}/`, { headers: { accept: 'application/json' } });
  const rootJson: any = rootRes.ok ? await rootRes.json() : null;
  const latestLedger =
    typeof rootJson?.core_latest_ledger === 'number' ? rootJson.core_latest_ledger : null;

  // 2) Fetch a small batch of recent operations as a simple "activity" proxy
  const endpoint = '/operations?order=desc&limit=200';
  const opsRes = await fetch(`${horizon}${endpoint}`, { headers: { accept: 'application/json' } });
  if (!opsRes.ok) throw new Error(`Horizon request failed: ${opsRes.status} ${opsRes.statusText}`);

  const opsJson: any = await opsRes.json();
  const records = opsJson?._embedded?.records ?? [];
  const sampleSize = records.length;

  // 3) Upsert protocol + venue
  const protocol = await prisma.protocol.upsert({
    where: { key: 'stellar' },
    update: { name: 'Stellar', category: 'network' },
    create: { key: 'stellar', name: 'Stellar', category: 'network' },
  });

  const venueKey = 'horizon:network-activity';
  const venue = await prisma.venue.upsert({
    where: { key: venueKey },
    update: {
      protocolId: protocol.id,
      type: 'pool',
      label: 'Horizon - Network Activity',
      meta: { horizon },
    },
    create: {
      key: venueKey,
      protocolId: protocol.id,
      type: 'pool',
      label: 'Horizon - Network Activity',
      meta: { horizon },
    },
  });

  // 4) Write snapshot
  await prisma.snapshot.create({
    data: {
      venueId: venue.id,
      ts: new Date(),
      volume: sampleSize, // simple activity proxy for the demo
      data: {
        source: 'horizon',
        horizonUrl: horizon,
        endpoint,
        sampleSize,
        latestLedger,
      },
    },
  });

  console.log('Horizon snapshot written:', venueKey, { sampleSize, latestLedger });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());