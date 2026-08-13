import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaService } from './db/prisma.service';

// E1 (Lot E): the enriched /health contract. PrismaService is mocked — these
// specs cover the status/degraded/503 logic, not the SQL.
describe('AppController /health', () => {
  let appController: AppController;
  const queryRawUnsafe = jest.fn();

  beforeEach(async () => {
    queryRawUnsafe.mockReset();
    delete process.env.GIT_SHA;

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: PrismaService,
          useValue: { $queryRawUnsafe: queryRawUnsafe },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('returns status ok with db + freshness when everything is fresh', async () => {
    const now = new Date().toISOString();
    queryRawUnsafe
      .mockResolvedValueOnce([{ venue: 'blend', as_of: now }])
      .mockResolvedValueOnce([{ last_refresh_at: now }]);

    const res = await appController.health();

    expect(res.status).toBe('ok');
    expect(res.version).toBe('unknown');
    expect(res.db.ok).toBe(true);
    expect(typeof res.db.latencyMs).toBe('number');
    expect(res.freshness).toEqual([
      expect.objectContaining({ venue: 'blend', isStale: false }),
    ]);
    expect(res.lastRefreshAt).toBe(now);
  });

  it('reports degraded (still resolving, not throwing) when a venue is stale', async () => {
    const staleAsOf = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    queryRawUnsafe
      .mockResolvedValueOnce([{ venue: 'blend', as_of: staleAsOf }])
      .mockResolvedValueOnce([{ last_refresh_at: staleAsOf }]);

    const res = await appController.health();

    expect(res.status).toBe('degraded');
    expect(res.db.ok).toBe(true);
    expect(res.freshness[0].isStale).toBe(true);
  });

  it('uses GIT_SHA as version when set', async () => {
    process.env.GIT_SHA = 'abc1234';
    queryRawUnsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ last_refresh_at: null }]);

    const res = await appController.health();

    expect(res.version).toBe('abc1234');
  });

  it('throws 503 with a degraded payload when the DB is unreachable', async () => {
    queryRawUnsafe.mockRejectedValue(new Error('connect ECONNREFUSED'));

    try {
      await appController.health();
      fail('expected HttpException');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const e = err as HttpException;
      expect(e.getStatus()).toBe(503);
      const body = e.getResponse() as Record<string, unknown>;
      expect(body.status).toBe('degraded');
      expect((body.db as { ok: boolean }).ok).toBe(false);
    }
  });
});
