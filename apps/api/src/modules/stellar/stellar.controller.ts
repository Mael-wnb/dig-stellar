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
}