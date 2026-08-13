// apps/api/src/modules/ops/ops.controller.ts
import { Controller, Get } from '@nestjs/common';
import { OpsService } from './ops.service';

// E2 (Lot E — T3-D3): public read-only ops endpoints. Must never leak secrets,
// env values or internal URLs (see ops.service.ts).
@Controller('v1/ops')
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get('metrics')
  getMetrics() {
    return this.opsService.getMetrics();
  }

  // E3: adoption counters — builds only (honest boundary stated in the payload).
  @Get('adoption')
  getAdoption() {
    return this.opsService.getAdoption();
  }
}
