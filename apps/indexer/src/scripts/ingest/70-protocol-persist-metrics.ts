import { createPgClient } from '../shared/db';
import { getVenueBySlugOrThrow } from '../shared/lookup';
import { nowIso } from '../discovery/00-common';

async function persistProtocol(
  client: ReturnType<typeof createPgClient>,
  venueSlug: string
) {
  const venue = await getVenueBySlugOrThrow(client, venueSlug);

  const poolsRes = await client.query(
    `
    select
      tvl_usd,
      volume_24h_usd,
      fees_24h_usd,
      total_supplied_usd,
      total_borrowed_usd,
      weighted_supply_apy,
      weighted_borrow_apy
    from pool_metrics_latest
    where venue_id = $1
    `,
    [venue.id]
  );

  let tvlUsd = 0;
  let volume24hUsd = 0;
  let fees24hUsd = 0;

  let supplyWeighted = 0;
  let borrowWeighted = 0;
  let supplyBase = 0;
  let borrowBase = 0;

  for (const row of poolsRes.rows as Array<any>) {
    const rowTvl = row.tvl_usd ? Number(row.tvl_usd) : 0;
    const rowVolume = row.volume_24h_usd ? Number(row.volume_24h_usd) : 0;
    const rowFees = row.fees_24h_usd ? Number(row.fees_24h_usd) : 0;
    const rowSupplied = row.total_supplied_usd ? Number(row.total_supplied_usd) : 0;
    const rowBorrowed = row.total_borrowed_usd ? Number(row.total_borrowed_usd) : 0;
    const rowSupplyApy = row.weighted_supply_apy ? Number(row.weighted_supply_apy) : 0;
    const rowBorrowApy = row.weighted_borrow_apy ? Number(row.weighted_borrow_apy) : 0;

    tvlUsd += rowTvl;
    volume24hUsd += rowVolume;
    fees24hUsd += rowFees;

    supplyWeighted += rowSupplied * rowSupplyApy;
    borrowWeighted += rowBorrowed * rowBorrowApy;
    supplyBase += rowSupplied;
    borrowBase += rowBorrowed;
  }

  const avgSupplyApy = supplyBase > 0 ? supplyWeighted / supplyBase : null;
  const avgBorrowApy = borrowBase > 0 ? borrowWeighted / borrowBase : null;

  const asOf = nowIso();

  await client.query(
    `
    insert into protocol_metrics_latest (
      venue_id,
      as_of,
      tvl_usd,
      volume_24h_usd,
      fees_24h_usd,
      avg_supply_apy,
      avg_borrow_apy,
      metadata
    )
    values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    on conflict (venue_id)
    do update set
      as_of = excluded.as_of,
      tvl_usd = excluded.tvl_usd,
      volume_24h_usd = excluded.volume_24h_usd,
      fees_24h_usd = excluded.fees_24h_usd,
      avg_supply_apy = excluded.avg_supply_apy,
      avg_borrow_apy = excluded.avg_borrow_apy,
      metadata = excluded.metadata,
      updated_at = now()
    `,
    [
      venue.id,
      asOf,
      tvlUsd,
      volume24hUsd,
      fees24hUsd,
      avgSupplyApy,
      avgBorrowApy,
      JSON.stringify({
        source: '70-protocol-persist-metrics',
        venueSlug,
      }),
    ]
  );

  console.log({
    completedAt: asOf,
    venueSlug,
    tvlUsd,
    volume24hUsd,
    fees24hUsd,
    avgSupplyApy,
    avgBorrowApy,
  });
}

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    await persistProtocol(client, 'blend');
    await persistProtocol(client, 'soroswap');
    await persistProtocol(client, 'aquarius');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});