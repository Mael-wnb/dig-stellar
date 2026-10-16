// apps/api/src/modules/campaign/campaign.controller.ts
//
// Lot EP (EP1): the campaign routes. Thin validation only (faucet convention);
// every decision — window, proof, enrolment, caps — lives in the service and
// the pure rules. Ineligibility is a 200 with a structured reason; 4xx only
// for malformed input. Every payload carries the no-monetary-value disclaimer.
// Public reads: GET /v1/campaign is cacheable (60 s); /me is no-store (polled).
// The leaderboard never carries a full address or a handle.

import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { CampaignService } from './campaign.service';
import { optionalReferralCode, requireAddress, requireUserId } from './request-validation';

interface EnrollBody {
  address?: string;
  userId?: string;
  referralCode?: string;
}

interface CheckinBody {
  address?: string;
  userId?: string;
}

@Controller('v1/campaign')
export class CampaignController {
  constructor(private readonly campaign: CampaignService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  getCampaign() {
    return this.campaign.getCampaign();
  }

  @Post('enroll')
  @HttpCode(HttpStatus.OK)
  enroll(@Body() body?: EnrollBody) {
    return this.campaign.enroll({
      address: requireAddress(body?.address),
      userId: requireUserId(body?.userId),
      referralCode: optionalReferralCode(body?.referralCode),
    });
  }

  @Post('checkin')
  @HttpCode(HttpStatus.OK)
  checkin(@Body() body?: CheckinBody) {
    return this.campaign.checkin({
      address: requireAddress(body?.address),
      userId: requireUserId(body?.userId),
    });
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Query('address') address?: string, @Query('userId') userId?: string) {
    return this.campaign.me({ address: requireAddress(address), userId: requireUserId(userId) });
  }

  @Get('leaderboard')
  @Header('Cache-Control', 'public, max-age=60')
  leaderboard(@Query('address') address?: string) {
    const caller = address != null && address !== '' ? requireAddress(address) : null;
    return this.campaign.leaderboard(caller);
  }
}
