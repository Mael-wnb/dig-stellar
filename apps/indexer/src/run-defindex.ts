import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { DefindexSDK, SupportedNetworks } from '@defindex/sdk';

const prisma = new PrismaClient();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function getVaultLabel(info: unknown): string {
  if (
    info &&
    typeof info === 'object' &&
    'name' in info &&
    typeof (info as { name?: unknown }).name === 'string'
  ) {
    return (info as { name: string }).name;
  }

  if (
    info &&
    typeof info === 'object' &&
    'name_symbol' in info &&
    typeof (info as { name_symbol?: unknown }).name_symbol === 'object' &&
    (info as { name_symbol: { name?: unknown } }).name_symbol?.name &&
    typeof (info as { name_symbol: { name?: unknown } }).name_symbol.name === 'string'
  ) {
    return (info as { name_symbol: { name: string } }).name_symbol.name;
  }

  return 'DeFindex Vault';
}

async function main() {
  const apiKey = required('DEFINDEX_API_KEY');
  const baseUrl = process.env.DEFINDEX_API_URL || 'https://api.defindex.io';

  const sdk = new DefindexSDK({
    apiKey,
    baseUrl,
    timeout: 30000,
  });

  const vaultAddresses = (process.env.DEFINDEX_VAULTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (vaultAddresses.length === 0) {
    throw new Error(
      'Missing DEFINDEX_VAULTS. Provide one or more real vault contract addresses separated by commas.',
    );
  }

  const protocol = await prisma.protocol.upsert({
    where: { key: 'defindex' },
    update: { name: 'DeFindex', category: 'yield' },
    create: { key: 'defindex', name: 'DeFindex', category: 'yield' },
  });

  let written = 0;

  for (const vaultAddress of vaultAddresses) {
    try {
      const info = await sdk.getVaultInfo(vaultAddress, SupportedNetworks.MAINNET);
      const apyInfo = await sdk.getVaultAPY(vaultAddress, SupportedNetworks.MAINNET);

      const apy = typeof apyInfo?.apy === 'number' ? apyInfo.apy : null;

      const venueKey = `defindex:vault:${vaultAddress}`;
      const label = getVaultLabel(info);

      const venue = await prisma.venue.upsert({
        where: { key: venueKey },
        update: {
          protocolId: protocol.id,
          type: 'vault',
          label,
          meta: {
            vaultAddress,
            network: 'mainnet',
          },
        },
        create: {
          key: venueKey,
          protocolId: protocol.id,
          type: 'vault',
          label,
          meta: {
            vaultAddress,
            network: 'mainnet',
          },
        },
      });

      await prisma.snapshot.create({
        data: {
          venueId: venue.id,
          ts: new Date(),
          apy,
          data: toPrismaJson({
            source: 'defindex-sdk',
            vaultAddress,
            network: 'mainnet',
            info,
            apyInfo,
          }),
        },
      });

      written += 1;
    } catch (error) {
      console.error(`Failed to process vault ${vaultAddress}:`, error);
    }
  }

  console.log(`DeFindex snapshots written: ${written}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });