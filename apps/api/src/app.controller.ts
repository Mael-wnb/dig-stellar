import { Controller, Get, HttpException, Param, Query } from '@nestjs/common';
import { PrismaService } from './db/prisma.service';
import { computeFreshness, staleAfterSeconds } from './common/freshness';

type HealthFreshnessRow = {
  venue: string;
  as_of: unknown;
};

type HealthVenueFreshness = {
  venue: string;
  asOf: unknown;
  ageSeconds: number | null;
  isStale: boolean | null;
};

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  // E1 (Lot E — T3-D3): enriched liveness. One cheap DB round-trip for the
  // per-venue freshness picture (same 45-min read-time rule as the /v1/* reads,
  // via common/freshness.ts) + one for lastRefreshAt. Always HTTP 200 with a
  // readable `status` ("ok" | "degraded") so a monitor can SEE the degraded
  // state; 503 only when the DB itself is unreachable. Public read-only: no
  // env values / connection strings — GIT_SHA short hash only.
  @Get('health')
  async health() {
    const version = process.env.GIT_SHA?.trim() || 'unknown';
    const uptimeSeconds = Math.round(process.uptime());

    let dbOk = true;
    let dbLatencyMs: number | null = null;
    let freshness: HealthVenueFreshness[] = [];
    let lastRefreshAt: unknown = null;

    try {
      const started = Date.now();
      const rows = (await this.prisma.$queryRawUnsafe(`
        select v.slug as venue, pm.as_of
        from venues v
        left join protocol_metrics_latest pm on pm.venue_id = v.id
        order by v.slug asc
      `)) as HealthFreshnessRow[];
      dbLatencyMs = Date.now() - started;

      freshness = rows.map((row) => {
        const f = computeFreshness(row.as_of);
        return {
          venue: row.venue,
          asOf: row.as_of ?? null,
          ageSeconds: f.ageSeconds,
          isStale: f.isStale,
        };
      });

      const last = (await this.prisma.$queryRawUnsafe(
        `select max(as_of) as last_refresh_at from network_tvl_snapshots`,
      )) as Array<{ last_refresh_at: unknown }>;
      lastRefreshAt = last[0]?.last_refresh_at ?? null;
    } catch {
      dbOk = false;
    }

    const anyStale = freshness.some((f) => f.isStale === true);
    const payload = {
      status: dbOk && !anyStale ? 'ok' : 'degraded',
      version,
      uptimeSeconds,
      db: { ok: dbOk, latencyMs: dbLatencyMs },
      staleAfterSeconds: staleAfterSeconds(),
      freshness,
      lastRefreshAt,
    };

    if (!dbOk) {
      // DB unreachable — the one case where a non-200 is the honest signal.
      throw new HttpException(payload, 503);
    }

    return payload;
  }

  @Get('protocols')
  async protocols() {
    return this.prisma.protocol.findMany({
      orderBy: { key: 'asc' },
      include: { venues: true },
    });
  }

  // ✅ NEW: list venues, optionally filtered by protocol key
  // GET /venues?protocol=blend
  @Get('venues')
  async venues(@Query('protocol') protocolKey?: string) {
    if (protocolKey) {
      return this.prisma.venue.findMany({
        where: { protocol: { key: protocolKey } },
        orderBy: { key: 'asc' },
        include: { protocol: true },
      });
    }

    return this.prisma.venue.findMany({
      orderBy: { key: 'asc' },
      include: { protocol: true },
    });
  }

  @Get('venues/:key/snapshots')
  async venueSnapshots(@Param('key') key: string, @Query('limit') limit = '200') {
    const venue = await this.prisma.venue.findUnique({ where: { key } });
    if (!venue) return { venue: null, snapshots: [] };

    const take = Math.min(parseInt(limit, 10) || 200, 1000);

    const snapshots = await this.prisma.snapshot.findMany({
      where: { venueId: venue.id },
      orderBy: { ts: 'desc' },
      take,
    });

    return { venue, snapshots };
  }
}