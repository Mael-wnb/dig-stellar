import { Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from './db/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  health() {
    return { ok: true };
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