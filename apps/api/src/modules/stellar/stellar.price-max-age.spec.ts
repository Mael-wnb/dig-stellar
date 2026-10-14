// apps/api/src/modules/stellar/stellar.price-max-age.spec.ts
//
// Price-sources v2, phase A2 (2026-09-29): every asset_prices read in the /v1/*
// path only accepts a FRESH row (PRICE_MAX_AGE_MINUTES, else the venue freshness
// threshold, default 45), so a dead feed's last row is never served forever, and
// a pool with no priced reserve yields NULL (never $0). Mock-based (no DB):
// capture the SQL each query sends and assert the filter and the NULL guard.
import { freshPriceSql, priceMaxAgeMinutes } from '../../common/freshness';
import { StellarService } from './stellar.service';

const ENTITY_ID = '11111111-1111-4111-8111-111111111111';

function serviceWith(queryRawUnsafe: jest.Mock) {
  const prisma = { $queryRawUnsafe: queryRawUnsafe } as never;
  return new StellarService(prisma);
}

describe('freshness helpers — price max age', () => {
  const saved = { p: process.env.PRICE_MAX_AGE_MINUTES, f: process.env.FRESHNESS_STALE_AFTER_MINUTES };
  afterEach(() => {
    if (saved.p === undefined) delete process.env.PRICE_MAX_AGE_MINUTES; else process.env.PRICE_MAX_AGE_MINUTES = saved.p;
    if (saved.f === undefined) delete process.env.FRESHNESS_STALE_AFTER_MINUTES; else process.env.FRESHNESS_STALE_AFTER_MINUTES = saved.f;
  });

  it('defaults to the venue freshness threshold (45), PRICE_MAX_AGE_MINUTES overrides, garbage ignored', () => {
    delete process.env.PRICE_MAX_AGE_MINUTES;
    delete process.env.FRESHNESS_STALE_AFTER_MINUTES;
    expect(priceMaxAgeMinutes()).toBe(45);
    process.env.FRESHNESS_STALE_AFTER_MINUTES = '30';
    expect(priceMaxAgeMinutes()).toBe(30);
    process.env.PRICE_MAX_AGE_MINUTES = '20';
    expect(priceMaxAgeMinutes()).toBe(20);
    process.env.PRICE_MAX_AGE_MINUTES = 'nope';
    expect(priceMaxAgeMinutes()).toBe(30);
    expect(freshPriceSql('ap2')).toBe("ap2.observed_at > now() - interval '30 minutes'");
  });
});

describe('StellarService — asset_prices reads accept fresh rows only (phase A2)', () => {
  const FRESH = /ap2?\.observed_at > now\(\) - interval '\d+ minutes'/;

  it('getProtocols top-assets: fresh filter, NULL tvl (no coalesce to 0), nulls ranked last', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await serviceWith(queryRawUnsafe).getProtocols();
    const [sql] = queryRawUnsafe.mock.calls[1] as [string];
    expect(sql).toMatch(FRESH);
    expect(sql).not.toMatch(/va\.amount \* coalesce\(/);
    expect(sql).toMatch(/order by tvl_usd desc nulls last/);
  });

  it('getPoolSeries: fresh filter, NULL when no reserve of a snapshot is priced', async () => {
    const queryRawUnsafe = jest
      .fn()
      .mockResolvedValueOnce([{ entity_id: ENTITY_ID, entity_type: 'lending_pool', venue_type: 'lending' }])
      .mockResolvedValueOnce([]);
    await serviceWith(queryRawUnsafe).getPoolSeries('blend-fixed-pool');
    const [sql] = queryRawUnsafe.mock.calls[1] as [string];
    expect(sql).toMatch(FRESH);
    expect(sql).toMatch(/case when count\(p\.price_usd\) = 0 then null/);
    expect(sql).toMatch(/left join lateral/);
  });

  it('getPools?sort=tvlUsd: NULL-TVL pools rank last in both directions (phase A2-bis)', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const svc = serviceWith(queryRawUnsafe);
    await svc.getPools(undefined, 'tvlUsd', 'desc');
    await svc.getPools('aquarius', 'tvlUsd', 'asc');
    await svc.getPools();
    // getPools issues a second (swap-count) query per call: keep the list queries only.
    const lists = queryRawUnsafe.mock.calls.map((c) => c[0] as string).filter((q) => /from entities e\s+join venues v/.test(q) && /order by/.test(q));
    expect(lists).toHaveLength(3);
    expect(lists[0]).toMatch(/order by pml\.tvl_usd desc nulls last, e\.slug asc/);
    expect(lists[1]).toMatch(/order by pml\.tvl_usd asc nulls last, e\.slug asc/);
    expect(lists[2]).toMatch(/order by v\.slug, e\.slug , e\.slug asc/);
  });

  it('getPoolSeries reducer: a NULL point is a gap, never a $0 point', async () => {
    const queryRawUnsafe = jest
      .fn()
      .mockResolvedValueOnce([{ entity_id: ENTITY_ID, entity_type: 'lending_pool', venue_type: 'lending' }])
      .mockResolvedValueOnce([
        { snapshot_at: new Date('2026-09-28T10:00:00Z'), day: '2026-09-28', tvl_usd: null },
        { snapshot_at: new Date('2026-09-29T10:00:00Z'), day: '2026-09-29', tvl_usd: '1234.5' },
      ]);
    const res = await serviceWith(queryRawUnsafe).getPoolSeries('blend-fixed-pool');
    expect(res.points).toEqual([{ day: '2026-09-29', tvlUsd: 1234.5 }]);
  });
});
