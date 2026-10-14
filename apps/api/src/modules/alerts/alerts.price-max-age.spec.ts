// apps/api/src/modules/alerts/alerts.price-max-age.spec.ts
//
// Price-sources v2, phase A2-bis: the alert evaluator's asset_prices reads obey
// the same max-age rule as every other reader (common/freshness.ts
// freshPriceSql). A stale price neither evaluates nor fires a price rule, is
// not offered in the rule modal, and a pool whose batch TVL would be null or
// partial for lack of a fresh price is excluded from the TVL-drop evaluation
// (NULL window → the evaluator skips). Mock-based (no DB): capture the SQL.
import { AlertsRepository } from './alerts.repository';

const ASSET_ID = '11111111-1111-4111-8111-111111111111';
const POOL_ID = '22222222-2222-4222-8222-222222222222';
const FRESH = /ap\.observed_at > now\(\) - interval '\d+ minutes'/;

function repoWith(queryRawUnsafe: jest.Mock) {
  const prisma = { $queryRawUnsafe: queryRawUnsafe } as never;
  return new AlertsRepository(prisma);
}

describe('AlertsRepository — asset_prices reads accept fresh rows only (phase A2-bis)', () => {
  it('latestPricesByAsset (price family): fresh filter, stale asset absent from the map', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const map = await repoWith(queryRawUnsafe).latestPricesByAsset([ASSET_ID]);
    const [sql, ids] = queryRawUnsafe.mock.calls[0] as [string, string[]];
    expect(sql).toMatch(FRESH);
    expect(ids).toEqual([ASSET_ID]);
    expect(map.has(ASSET_ID)).toBe(false);
  });

  it('listPricedAssets (rule modal): same fresh rule, no separate 7-day window', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    await repoWith(queryRawUnsafe).listPricedAssets();
    const [sql] = queryRawUnsafe.mock.calls[0] as [string];
    expect(sql).toMatch(FRESH);
    expect(sql).not.toMatch(/7 days/);
  });

  it('getPoolTvlWindows: fresh filter, NULL batch TVL when a reserve is unpriced, never coalesce(price, 0)', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    await repoWith(queryRawUnsafe).getPoolTvlWindows([POOL_ID]);
    const [sql] = queryRawUnsafe.mock.calls[0] as [string];
    expect(sql).toMatch(FRESH);
    expect(sql).toMatch(/case when count\(px\.price_usd\) < count\(\*\) then null/);
    expect(sql).not.toMatch(/coalesce\(px\.price_usd, 0\)/);
  });

  it('getPoolTvlWindows mapping: a NULL batch TVL stays null (the evaluator skips it) and carries the priced count', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([
      {
        entity_id: POOL_ID,
        latest_tvl_usd: null,
        prev_tvl_usd: '1000',
        latest_at: new Date('2026-10-14T12:00:00Z'),
        prev_at: new Date('2026-10-13T12:00:00Z'),
        latest_priced_reserves: '1',
        latest_reserves: '2',
      },
    ]);
    const map = await repoWith(queryRawUnsafe).getPoolTvlWindows([POOL_ID]);
    const win = map.get(POOL_ID);
    expect(win).toBeDefined();
    expect(win?.latestTvlUsd).toBeNull();
    expect(win?.prevTvlUsd).toBe(1000);
    expect(win?.latestPricedReserves).toBe(1);
    expect(win?.latestReserves).toBe(2);
  });
});
