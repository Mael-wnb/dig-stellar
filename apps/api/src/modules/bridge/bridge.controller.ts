// apps/api/src/modules/bridge/bridge.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { BridgeService } from './bridge.service';

@Controller('v1/bridge')
export class BridgeController {
  constructor(private readonly bridgeService: BridgeService) {}

  // Aggregated inflow/outflow over a whitelisted window (24h | 7d | 30d).
  @Get('summary')
  getSummary(@Query('window') window?: string) {
    return this.bridgeService.getSummary(window);
  }

  // Recent-flows feed (window-independent — latest N rows).
  @Get('flows')
  getFlows(
    @Query('direction') direction?: string,
    @Query('limit') limit?: string
  ) {
    const parsedLimit = limit !== undefined ? Number(limit) : undefined;
    return this.bridgeService.getFlows(direction, parsedLimit);
  }
}
