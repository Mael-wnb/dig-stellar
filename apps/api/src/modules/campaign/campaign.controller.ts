// apps/api/src/modules/campaign/campaign.controller.ts
//
// Lot EP (EP1): the campaign routes. Thin validation only (faucet convention);
// every decision — window, proof, enrolment, caps — lives in the service and
// the pure rules. Ineligibility is a 200 with a structured reason; 4xx only
// for malformed input. Every payload carries the campaign disclaimer line.
// Public reads: GET /v1/campaign is cacheable (60 s); /me is no-store (polled).
// The leaderboard never carries a full address or a handle.
// EP2: POST /social and DELETE /social/:id (self-declared tasks). The handle
// is normalised here and never echoed back.
// EP3: GET /metrics — public counts only (never an address), cacheable 60 s.
// EP4: GET /me/activity — the wallet's last ledger rows, same access rule as
// /me (address + userId, no proof for reads), no-store.

import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CampaignService } from './campaign.service';
import { CampaignSocialService } from './campaign-social.service';
import {
  optionalReferralCode,
  requireAddress,
  requireClaimId,
  requireHandle,
  requireTaskKey,
  requireUserId,
} from './request-validation';

interface EnrollBody {
  address?: string;
  userId?: string;
  referralCode?: string;
}

interface CheckinBody {
  address?: string;
  userId?: string;
}

interface SocialClaimBody extends CheckinBody {
  task?: string;
  handle?: string;
}

@Controller('v1/campaign')
export class CampaignController {
  constructor(
    private readonly campaign: CampaignService,
    private readonly social: CampaignSocialService,
  ) {}

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

  @Post('social')
  @HttpCode(HttpStatus.OK)
  claimSocial(@Body() body?: SocialClaimBody) {
    return this.social.claim({
      address: requireAddress(body?.address),
      userId: requireUserId(body?.userId),
      task: requireTaskKey(body?.task),
      handle: requireHandle(body?.handle),
    });
  }

  @Delete('social/:id')
  @HttpCode(HttpStatus.OK)
  deleteSocial(@Param('id') id?: string, @Body() body?: CheckinBody) {
    return this.social.remove({
      address: requireAddress(body?.address),
      userId: requireUserId(body?.userId),
      id: requireClaimId(id),
    });
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Query('address') address?: string, @Query('userId') userId?: string) {
    return this.campaign.me({ address: requireAddress(address), userId: requireUserId(userId) });
  }

  @Get('me/activity')
  @Header('Cache-Control', 'no-store')
  activity(@Query('address') address?: string, @Query('userId') userId?: string) {
    return this.campaign.activity({ address: requireAddress(address), userId: requireUserId(userId) });
  }

  @Get('leaderboard')
  @Header('Cache-Control', 'public, max-age=60')
  leaderboard(@Query('address') address?: string) {
    const caller = address != null && address !== '' ? requireAddress(address) : null;
    return this.campaign.leaderboard(caller);
  }

  @Get('metrics')
  @Header('Cache-Control', 'public, max-age=60')
  metrics() {
    return this.campaign.metrics();
  }
}
