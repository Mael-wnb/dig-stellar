import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const protocol = await prisma.protocol.upsert({
    where: { key: 'blend' },
    update: { name: 'Blend', category: 'lending' },
    create: { key: 'blend', name: 'Blend', category: 'lending' },
  });

  const venue = await prisma.venue.upsert({
    where: { key: 'blend:demo-market' },
    update: { label: 'Demo Market', type: 'market', protocolId: protocol.id },
    create: {
      key: 'blend:demo-market',
      type: 'market',
      label: 'Demo Market',
      protocolId: protocol.id,
      meta: { note: 'seeded for grant demo' },
    },
  });

  await prisma.snapshot.create({
    data: {
      venueId: venue.id,
      ts: new Date(),
      tvl: 123456.78,
      utilization: 0.42,
      inflow: 1000,
      outflow: 250,
      netflow: 750,
      data: { source: 'seed', window: 'now' },
    },
  });

  console.log('Seed OK:', { protocol: protocol.key, venue: venue.key });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
