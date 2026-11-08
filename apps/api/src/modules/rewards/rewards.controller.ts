// apps/api/src/modules/rewards/rewards.controller.ts
//
// Lot EP (EP5): the two rewards routes under /v1/campaign/rewards. Thin
// validation only (campaign convention, shared request-validation): every
// decision lives in the service and the pure rules. Ineligibility and payout
// failure are 200s with a structured reason (the web renders the honest
// reason); 4xx only for malformed input. /me is no-store (polled after every
// write). POST /claim belongs in Lot S's strict nginx zone like the faucet
// claim (it moves money).

import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { requireAddress, requireUserId } from '../campaign/request-validation';
import { RewardsService } from './rewards.service';

interface ClaimBody {
  address?: string;
  userId?: string;
}

@Controller('v1/campaign/rewards')
export class RewardsController {
  constructor(private readonly rewards: RewardsService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Query('address') address?: string, @Query('userId') userId?: string) {
    return this.rewards.me({ address: requireAddress(address), userId: requireUserId(userId) });
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  claim(@Body() body?: ClaimBody) {
    return this.rewards.claim({
      address: requireAddress(body?.address),
      userId: requireUserId(body?.userId),
    });
  }
}
