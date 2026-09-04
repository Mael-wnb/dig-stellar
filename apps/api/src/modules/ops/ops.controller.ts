// apps/api/src/modules/ops/ops.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
} from '@nestjs/common';
import { OpsService } from './ops.service';

// The only window the status endpoint serves for now (beta scope). Anything
// else is a 400 listing the supported values, so a future 7d/30d is additive.
const SUPPORTED_STATUS_WINDOWS = ['24h'];

// E2 (Lot E — T3-D3): public read-only ops endpoints. Must never leak secrets,
// env values or internal URLs (see ops.service.ts).
@Controller('v1/ops')
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get('metrics')
  getMetrics() {
    return this.opsService.getMetrics();
  }

  // Lot ST (T3-D3 follow-up): the status-page payload. Refresh-pipeline
  // visibility (our own runs), NOT an external uptime probe. no-store like the
  // faucet eligibility read: the payload embeds `now`, caching it lies.
  @Get('status')
  @Header('Cache-Control', 'no-store')
  getStatus(@Query('window') window?: string) {
    const requested = window ?? '24h';
    if (!SUPPORTED_STATUS_WINDOWS.includes(requested)) {
      throw new BadRequestException(
        `Unsupported window '${requested}'. Supported: ${SUPPORTED_STATUS_WINDOWS.join(', ')}`,
      );
    }
    return this.opsService.getStatus();
  }

  // E3: adoption counters — builds only (honest boundary stated in the payload).
  @Get('adoption')
  getAdoption() {
    return this.opsService.getAdoption();
  }
}
