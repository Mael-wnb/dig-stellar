// apps/api/src/modules/stellar/stellar.controller.ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { StellarService } from './stellar.service';

@Controller('v1')
export class StellarController {
  constructor(private readonly stellarService: StellarService) {}

  @Get('protocols')
  getProtocols() {
    return this.stellarService.getProtocols();
  }

  @Get('pools')
  getPools(
    @Query('protocol') protocol?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: 'asc' | 'desc'
  ) {
    return this.stellarService.getPools(protocol, sort, order);
  }

  @Get('pools/:poolSlug')
  getPoolDetail(@Param('poolSlug') poolSlug: string) {
    return this.stellarService.getPoolDetail(poolSlug);
  }

  // Inflows & outflows (Lot C): on-read deposit/withdraw aggregation over
  // normalized_events. `window` ∈ {24h,7d,30d} (default 7d). Returns
  // covered=false for pools without deposit/withdraw event coverage so the UI
  // hides the section rather than showing zeros.
  @Get('pools/:poolSlug/flows')
  getPoolFlows(
    @Param('poolSlug') poolSlug: string,
    @Query('window') window?: string
  ) {
    return this.stellarService.getPoolFlows(poolSlug, window);
  }

  // TVL history (Lot C): Blend-only honest reconstruction from reserve
  // snapshots. covered=false for non-lending pools (UI keeps the honest note).
  @Get('pools/:poolSlug/series')
  getPoolSeries(@Param('poolSlug') poolSlug: string) {
    return this.stellarService.getPoolSeries(poolSlug);
  }
}