import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PoolV2, PoolEstimate, type Network } from '@blend-capital/blend-sdk';

const prisma = new PrismaClient();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// JSON-safe: BigInt -> string, Map -> array
function toPlainJson(value: unknown) {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (v instanceof Map) return Array.from(v.entries());
      if (v instanceof Set) return Array.from(v.values());
      return v;
    }),
  );
}

// Utilization ratio for a reserve using BigInt and safe scaling
// utilization = borrowed / supplied in [0..1]
function utilizationFromSupplies(bSupplyRaw: unknown, dSupplyRaw: unknown): number | null {
  try {
    const supplied = BigInt(String(bSupplyRaw ?? '0'));
    const borrowed = BigInt(String(dSupplyRaw ?? '0'));
    if (supplied <= 0n) return null;

    // ratioScaled = (borrowed / supplied) * 1e6
    const ratioScaled = (borrowed * 1_000_000n) / supplied; // <= 1_000_000
    return Number(ratioScaled) / 1_000_000;
  } catch {
    return null;
  }
}

async function main() {
  const rpc = required('STELLAR_RPC_URL');
  const passphrase = required('STELLAR_NETWORK_PASSPHRASE');
  const poolId = required('BLEND_POOL_ID');

  const network: Network = {
    rpc,
    passphrase,
    opts: { allowHttp: rpc.startsWith('http://') },
  };

  // Load pool + oracle + estimates
  const pool = await PoolV2.load(network, poolId);
  const oracle = await pool.loadOracle();
  const est = PoolEstimate.build(pool.reserves, oracle);

  // Upsert protocol
  const protocol = await prisma.protocol.upsert({
    where: { key: 'blend' },
    update: { name: 'Blend', category: 'lending' },
    create: { key: 'blend', name: 'Blend', category: 'lending' },
  });

  const now = new Date();

  // ---- A) Pool-level venue + snapshot (clean columns)
  const poolVenueKey = `blend:pool:${poolId}`;
  const poolVenue = await prisma.venue.upsert({
    where: { key: poolVenueKey },
    update: { protocolId: protocol.id, type: 'market', label: 'Blend Pool', meta: { poolId } },
    create: { key: poolVenueKey, protocolId: protocol.id, type: 'market', label: 'Blend Pool', meta: { poolId } },
  });

  const poolTvl = typeof est.totalSupply === 'number' ? est.totalSupply : null;
  const poolBorrowed = typeof est.totalBorrowed === 'number' ? est.totalBorrowed : null;
  const poolUtil = poolTvl && poolBorrowed ? poolBorrowed / poolTvl : null;
  const poolApy = typeof est.avgBorrowApy === 'number' ? est.avgBorrowApy : null;

  await prisma.snapshot.create({
    data: {
      venueId: poolVenue.id,
      ts: now,
      tvl: poolTvl,
      utilization: poolUtil,
      apy: poolApy,
      data: {
        source: 'blend-sdk',
        poolId,
        // keep a compact summary for reviewers
        estimate: {
          totalSupply: est.totalSupply,
          totalBorrowed: est.totalBorrowed,
          avgBorrowApy: est.avgBorrowApy,
        },
        reserveCount: pool.reserves.size,
      },
    },
  });

  // ---- B) Reserve-level venues + snapshots
  // Map -> array entries: [assetId, reserveObj]
  const reserveEntries = Array.from(pool.reserves.entries());

  for (const [assetId, r] of reserveEntries) {
    const reserveVenueKey = `blend:reserve:${poolId}:${assetId}`;

    const reserveVenue = await prisma.venue.upsert({
      where: { key: reserveVenueKey },
      update: {
        protocolId: protocol.id,
        type: 'market',
        label: `Blend Reserve`,
        meta: { poolId, assetId },
      },
      create: {
        key: reserveVenueKey,
        protocolId: protocol.id,
        type: 'market',
        label: `Blend Reserve`,
        meta: { poolId, assetId },
      },
    });

    // Most useful metrics
    const supplyApy = typeof r.estSupplyApy === 'number' ? r.estSupplyApy : null;
    const borrowApy = typeof r.estBorrowApy === 'number' ? r.estBorrowApy : null;

    const bSupply = (r as any)?.reserve?.data?.bSupply;
    const dSupply = (r as any)?.reserve?.data?.dSupply;
    const util = utilizationFromSupplies(bSupply, dSupply);

    // Store compact JSON (avoid dumping everything)
    await prisma.snapshot.create({
      data: {
        venueId: reserveVenue.id,
        ts: now,
        apy: supplyApy, // choose supply APY as primary; borrow is in JSON
        utilization: util,
        data: {
          source: 'blend-sdk',
          poolId,
          assetId,
          latestLedger: r.latestLedger,
          supplyApr: r.supplyApr,
          borrowApr: r.borrowApr,
          estSupplyApy: supplyApy,
          estBorrowApy: borrowApy,
          // raw supplies for traceability
          bSupply: String(bSupply ?? '0'),
          dSupply: String(dSupply ?? '0'),
          // keep config highlights (optional)
          decimals: (r as any)?.reserve?.config?.decimals,
          enabled: (r as any)?.reserve?.config?.enabled,
        },
      },
    });
  }

  console.log('Blend snapshots written:', {
    poolVenueKey,
    reserveVenues: reserveEntries.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());