// apps/api/src/modules/network/network.controller.ts
import { Controller, Get } from '@nestjs/common';
import { NetworkService } from './network.service';

@Controller('v1/network')
export class NetworkController {
  constructor(private readonly networkService: NetworkService) {}

  @Get('stats')
  getNetworkStats() {
    return this.networkService.getNetworkStats();
  }

  // G4 (Lot G): network TVL 7-day series from network_tvl_snapshots (G0).
  @Get('tvl-series')
  getTvlSeries() {
    return this.networkService.getTvlSeries();
  }
}