// apps/api/src/modules/stellar/stellar.list-cache.spec.ts
//
// perf/pools-latency (2026-10-30): /v1/pools and /v1/protocols cache their raw
// rows in-process for STELLAR_LIST_CACHE_TTL_MS (default 90 s). Mock-based
// (no DB): count the SQL round-trips per call and assert that (a) a repeat
// call inside the TTL issues none, (b) a call after the TTL issues them again,
// (c) different query params are different keys, (d) freshness fields keep
// ticking on a cache hit (they are computed at read time, not cached), and
// (e) the swap-count statement is shaped for the partial index.
import { StellarService } from './stellar.service';

function serviceWith(queryRawUnsafe: jest.Mock) {
  const prisma = { $queryRawUnsafe: queryRawUnsafe } as never;
  return new StellarService(prisma);
}

const POOL_ROW = {
  entity_slug: 'aquarius-xlm-usdc-pool',
  entity_name: 'XLM/USDC',
  entity_type: 'amm_pool',
  contract_address: 'C...',
  protocol_slug: 'aquarius',
  protocol_name: 'Aquarius',
  protocol_type: 'amm',
  protocol_logo_url: null,
  chain: 'stellar',
  tvl_usd: '1000',
  volume_24h_usd: '10',
  fees_24h_usd: '1',
  total_supplied_usd: null,
  total_borrowed_usd: null,
  weighted_supply_apy: null,
  weighted_borrow_apy: null,
  metrics_metadata: {},
  as_of: new Date('2026-10-30T10:00:00Z'),
};

describe('StellarService — list endpoints cache raw rows for the TTL', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-30T10:01:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('getPools: hit within TTL (no SQL), miss after TTL (SQL again)', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const svc = serviceWith(queryRawUnsafe);

    await svc.getPools();
    expect(queryRawUnsafe).toHaveBeenCalledTimes(3); // list + swaps + tokens

    jest.advanceTimersByTime(89_000);
    await svc.getPools();
    expect(queryRawUnsafe).toHaveBeenCalledTimes(3);

    jest.advanceTimersByTime(2_000); // 91 s since the load
    await svc.getPools();
    expect(queryRawUnsafe).toHaveBeenCalledTimes(6);
  });

  it('getPools: protocol / sort / order are part of the key', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const svc = serviceWith(queryRawUnsafe);

    await svc.getPools();
    await svc.getPools('aquarius');
    await svc.getPools(undefined, 'tvlUsd', 'asc');
    await svc.getPools(undefined, 'tvlUsd', 'desc');
    expect(queryRawUnsafe).toHaveBeenCalledTimes(12);

    await svc.getPools('aquarius');
    expect(queryRawUnsafe).toHaveBeenCalledTimes(12);
  });

  it('getProtocols: hit within TTL, miss after TTL', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const svc = serviceWith(queryRawUnsafe);

    await svc.getProtocols();
    await svc.getProtocols();
    expect(queryRawUnsafe).toHaveBeenCalledTimes(2); // venues + top-assets CTE

    jest.advanceTimersByTime(90_001);
    await svc.getProtocols();
    expect(queryRawUnsafe).toHaveBeenCalledTimes(4);
  });

  it('freshness fields are computed at read time, not frozen with the cached rows', async () => {
    const queryRawUnsafe = jest
      .fn()
      .mockResolvedValueOnce([POOL_ROW]) // list
      .mockResolvedValueOnce([{ entity_slug: POOL_ROW.entity_slug, swaps_24h: 7, swap_events_ever: true }])
      .mockResolvedValueOnce([]); // tokens
    const svc = serviceWith(queryRawUnsafe);

    const first = await svc.getPools();
    expect(first[0].ageSeconds).toBe(60);
    expect(first[0].metrics.swaps24h).toBe(7);

    jest.advanceTimersByTime(30_000);
    const second = await svc.getPools();
    expect(queryRawUnsafe).toHaveBeenCalledTimes(3); // served from cache …
    expect(second[0].ageSeconds).toBe(90); // … but the age kept ticking
    expect(second[0].metrics.swaps24h).toBe(7);
  });

  it('swap coverage: exists=false → swaps24h null (dash), exists=true + 0 → 0', async () => {
    const covered = { ...POOL_ROW, entity_slug: 'covered' };
    const uncovered = { ...POOL_ROW, entity_slug: 'uncovered' };
    const queryRawUnsafe = jest
      .fn()
      .mockResolvedValueOnce([covered, uncovered])
      .mockResolvedValueOnce([
        { entity_slug: 'covered', swaps_24h: 0, swap_events_ever: true },
        { entity_slug: 'uncovered', swaps_24h: 0, swap_events_ever: false },
      ])
      .mockResolvedValueOnce([]);
    const res = await serviceWith(queryRawUnsafe).getPools();
    expect(res.find((p) => p.id === 'covered')?.metrics.swaps24h).toBe(0);
    expect(res.find((p) => p.id === 'uncovered')?.metrics.swaps24h).toBeNull();
  });

  it('swap-count statement: per active entity, correlated 24h count + EXISTS, both carrying the partial-index predicate', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    await serviceWith(queryRawUnsafe).getPools();
    const [sql] = queryRawUnsafe.mock.calls[1] as [string];
    const PRED = /\(ne\.event_key like '%:trade' or ne\.event_key like '%:swap'\)/g;
    expect(sql).toMatch(/from entities e\s+where e\.is_active = true/);
    expect(sql).toMatch(/select count\(\*\)::int\s+from normalized_events ne\s+where ne\.entity_id = e\.id/);
    expect(sql).toMatch(/exists \(\s+select 1\s+from normalized_events ne\s+where ne\.entity_id = e\.id/);
    expect(sql).toMatch(/ne\.occurred_at >= now\(\) - interval '24 hours'/);
    expect(sql.match(PRED)).toHaveLength(2);
    // The Lot Q whole-table group-by must be gone.
    expect(sql).not.toMatch(/group by e\.slug/);
  });
});
