// apps/api/src/modules/faucet/faucet.controller.ts
//
// R2 (Lot R — T3-D2): the two faucet endpoints. Thin validation only — every
// decision lives in the service (which re-checks EVERYTHING on claim; the GET
// is advisory for the UI). Both endpoints belong in Lot S's strict nginx
// rate-limit zone (VPS config, founder-side — verified for /v1/actions/witness
// at R1 ratification; add /v1/faucet/* the same way).
//
// Ineligibility and payout failure are 200s with structured reasons (the R3
// UI renders the honest reason — never a dead button); 4xx is reserved for
// malformed input.

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FaucetService } from './faucet.service';

const STELLAR_PUBKEY_RE = /^G[A-Z2-7]{55}$/;

interface ClaimBody {
  wallet: string;
}

@Controller('v1/faucet')
export class FaucetController {
  constructor(private readonly faucetService: FaucetService) {}

  /**
   * Campaign state (+ per-wallet eligibility when ?wallet= is given). The
   * wallet-less form is what the R3 promo surface polls — it must stay cheap
   * (one COUNT query, no Horizon).
   */
  @Get('eligibility')
  async eligibility(@Query('wallet') wallet?: string) {
    if (wallet != null && !STELLAR_PUBKEY_RE.test(wallet)) {
      throw new BadRequestException('wallet must be a Stellar public key (G…)');
    }
    return this.faucetService.getEligibility(wallet);
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  async claim(@Body() body: ClaimBody) {
    const wallet = body?.wallet;
    if (!wallet || typeof wallet !== 'string' || !STELLAR_PUBKEY_RE.test(wallet)) {
      throw new BadRequestException('wallet must be a Stellar public key (G…)');
    }
    return this.faucetService.claim(wallet);
  }
}
