// apps/api/src/modules/stellar/stellar.pool-series-amount.spec.ts
//
// Lot XO (2026-10-30): the pool TVL history series multiplies the per-reserve
// amount that DEFINES TVL for the venue by the latest price. Blend keeps
// supplied (b_supply_scaled); XOXNO uses pool cash (reserve_snapshots
// .metadata.cash, what pool.get_reserves returns) so the chart matches the hub
// TVL in pool_metrics_latest (cash × price over priced markets).
//
// Mock-based (no DB): capture the SQL the series query sends per venue and
// assert the amount expression, as stellar.supplied-side.spec.ts does.
import { StellarService } from './stellar.service';

const ENTITY_ID = '11111111-1111-4111-8111-111111111111';

function serviceWith(queryRawUnsafe: jest.Mock) {
  const prisma = { $queryRawUnsafe: queryRawUnsafe } as never;
  return new StellarService(prisma);
}

function seriesSqlFor(venueSlug: string, poolSlug: string) {
  const queryRawUnsafe = jest
    .fn()
    .mockResolvedValueOnce([
      { entity_id: ENTITY_ID, entity_type: 'lending_pool', venue_type: 'lending', venue_slug: venueSlug },
    ])
    .mockResolvedValueOnce([]);
  const service = serviceWith(queryRawUnsafe);
  return service.getPoolSeries(poolSlug).then((result) => {
    expect(queryRawUnsafe).toHaveBeenCalledTimes(2);
    const [sql, entityId] = queryRawUnsafe.mock.calls[1] as [string, string];
    expect(entityId).toBe(ENTITY_ID);
    return { sql, result };
  });
}

describe('StellarService.getPoolSeries — per-venue TVL amount', () => {
  it('Blend: supplied (b_supply_scaled) × price, unchanged', async () => {
    const { sql, result } = await seriesSqlFor('blend', 'blend-fixed-pool');
    expect(result.covered).toBe(false); // no rows → honest empty series
    expect(sql).toMatch(/sum\(coalesce\(rs\.b_supply_scaled, 0\) \* coalesce\(p\.price_usd, 0\)\) end as tvl_usd/);
    expect(sql).not.toMatch(/metadata->>'cash'/);
    expect(sql).not.toMatch(/rs\.d_supply_scaled/);
  });

  it('XOXNO: pool cash (metadata.cash) × price, never supplied', async () => {
    const { sql, result } = await seriesSqlFor('xoxno', 'xoxno-core-hub');
    expect(result.covered).toBe(false);
    expect(sql).toMatch(/sum\(coalesce\(\(rs\.metadata->>'cash'\)::numeric, 0\) \* coalesce\(p\.price_usd, 0\)\) end as tvl_usd/);
    expect(sql).not.toMatch(/rs\.b_supply_scaled/);
    expect(sql).not.toMatch(/rs\.d_supply_scaled/);
  });

  it('the pool lookup carries the venue slug the amount choice keys on', async () => {
    const queryRawUnsafe = jest
      .fn()
      .mockResolvedValueOnce([
        { entity_id: ENTITY_ID, entity_type: 'lending_pool', venue_type: 'lending', venue_slug: 'xoxno' },
      ])
      .mockResolvedValueOnce([]);
    await serviceWith(queryRawUnsafe).getPoolSeries('xoxno-rwa-hub');
    const [lookupSql] = queryRawUnsafe.mock.calls[0] as [string];
    expect(lookupSql).toMatch(/v\.slug as venue_slug/);
  });
});
