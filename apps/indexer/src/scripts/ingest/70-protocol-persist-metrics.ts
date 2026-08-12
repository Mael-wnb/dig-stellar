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
      pm.tvl_usd,
      pm.volume_24h_usd,
      pm.fees_24h_usd,
      pm.total_supplied_usd,
      pm.total_borrowed_usd,
      pm.weighted_supply_apy,
      pm.weighted_borrow_apy
    from pool_metrics_latest pm
    join entities e on e.id = pm.entity_id
    where pm.venue_id = $1 and e.is_active = true
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

// G0 (Lot G / T3-D3): leave one network-TVL point behind on every refresh cycle.
// History accumulates — it cannot be reconstructed later without historized
// prices — so this runs at the tail of step 7, once protocol_metrics_latest is
// fully rewritten. The row is the sum over protocol_metrics_latest.tvl_usd (the
// exact figure the dashboard hero shows) plus the count of protocols folded in.
// Idempotent per run: as_of is truncated to the minute and upserted, so a
// re-run of the same cycle overwrites its point rather than duplicating it.
async function persistNetworkTvlSnapshot(
  client: ReturnType<typeof createPgClient>
) {
  const res = await client.query(
    `
    insert into network_tvl_snapshots (as_of, tvl_usd, protocol_count)
    select
      date_trunc('minute', now()),
      coalesce(sum(pm.tvl_usd), 0),
      count(*)
    from protocol_metrics_latest pm
    on conflict (as_of) do update set
      tvl_usd = excluded.tvl_usd,
      protocol_count = excluded.protocol_count
    returning as_of, tvl_usd, protocol_count
    `
  );

  const row = res.rows[0] as
    | { as_of: Date; tvl_usd: string; protocol_count: number }
    | undefined;

  console.log({
    networkTvlSnapshot: true,
    asOf: row?.as_of,
    tvlUsd: row ? Number(row.tvl_usd) : null,
    protocolCount: row?.protocol_count ?? null,
  });
}

async function main() {
  const client = createPgClient();
  await client.connect();

  try {
    await persistProtocol(client, 'blend');
    await persistProtocol(client, 'soroswap');
    await persistProtocol(client, 'aquarius');
    await persistProtocol(client, 'stellar-native');
    await persistProtocol(client, 'defindex');

    await persistNetworkTvlSnapshot(client);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});