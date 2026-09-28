// apps/api/src/modules/stellar/stellar.supplied-side.spec.ts
//
// Hotfix regression (2026-09-28): the "supplied" side of a lending reserve is
// b_supply_scaled (indexer convention: b = supplied, d = borrowed, see
// apps/indexer/src/lib/protocols/blend/compute-pool-metrics.ts). Two read
// queries summed d_supply_scaled instead, so the pool TVL series and the
// per-venue top assets showed BORROWED figures for Blend.
//
// Mock-based (no DB): capture the SQL each query sends and assert the column
// choice. SQL-text assertions are the only DB-free option; they fail on the
// old column choice (mutation-checked in the hotfix evidence).
import { StellarService } from './stellar.service';

const ENTITY_ID = '11111111-1111-4111-8111-111111111111';

function serviceWith(queryRawUnsafe: jest.Mock) {
  const prisma = { $queryRawUnsafe: queryRawUnsafe } as never;
  return new StellarService(prisma);
}

describe('StellarService — lending "supplied" side reads b_supply_scaled', () => {
  it('getProtocols top-assets CTE keys the amount on venue_type (lending → b_supply_scaled)', async () => {
    const queryRawUnsafe = jest
      .fn()
      .mockResolvedValueOnce([]) // venues ⟕ protocol_metrics_latest
      .mockResolvedValueOnce([]); // top-assets CTE
    const service = serviceWith(queryRawUnsafe);

    await service.getProtocols();

    expect(queryRawUnsafe).toHaveBeenCalledTimes(2);
    const [sql] = queryRawUnsafe.mock.calls[1] as [string];
    expect(sql).toContain('venue_assets as (');
    expect(sql).toMatch(
      /case when v\.venue_type = 'lending' then rs\.b_supply_scaled else rs\.d_supply_scaled end/,
    );
    // The old, wrong expression must be gone.
    expect(sql).not.toMatch(/sum\(coalesce\(rs\.d_supply_scaled, 0\)\)/);
  });

  it('getPoolSeries (lending-only) sums b_supply_scaled × price, never d_supply_scaled', async () => {
    const queryRawUnsafe = jest
      .fn()
      .mockResolvedValueOnce([
        { entity_id: ENTITY_ID, entity_type: 'lending_pool', venue_type: 'lending' },
      ])
      .mockResolvedValueOnce([]);
    const service = serviceWith(queryRawUnsafe);

    const result = await service.getPoolSeries('blend-fixed-pool');

    expect(result.covered).toBe(false); // no rows → honest empty series
    expect(queryRawUnsafe).toHaveBeenCalledTimes(2);
    const [sql, entityId] = queryRawUnsafe.mock.calls[1] as [string, string];
    expect(entityId).toBe(ENTITY_ID);
    expect(sql).toMatch(/sum\(coalesce\(rs\.b_supply_scaled, 0\) \* coalesce\(p\.price_usd, 0\)\) as tvl_usd/);
    expect(sql).not.toMatch(/rs\.d_supply_scaled/);
  });
});
