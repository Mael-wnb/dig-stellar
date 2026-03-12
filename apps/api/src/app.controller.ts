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