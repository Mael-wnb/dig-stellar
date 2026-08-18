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
  Header,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FaucetService } from './faucet.service';
import { FAUCET_FAMILIES, type ActionFamily } from './faucet-eligibility';

const STELLAR_PUBKEY_RE = /^G[A-Z2-7]{55}$/;

interface ClaimBody {
  wallet: string;
  /** Campaign 2 (Lot R2): which family this claim is for. */
  family: string;
}

@Controller('v1/faucet')
export class FaucetController {
  constructor(private readonly faucetService: FaucetService) {}

  /**
   * Campaign state (+ per-wallet eligibility when ?wallet= is given). The
   * wallet-less form is what the R3 promo surface polls — it must stay cheap
   * (one COUNT query, no Horizon).
   */
  // R3c: this endpoint is POLLED (promo + claim panel) — it must never be
  // cached by the browser or an intermediary (prod incident 2026-08-17: 304s
  // froze the claim panel on stale eligibility).
  @Get('eligibility')
  @Header('Cache-Control', 'no-store')
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
    const family = body?.family;
    if (
      !family ||
      typeof family !== 'string' ||
      !(FAUCET_FAMILIES as readonly string[]).includes(family)
    ) {
      throw new BadRequestException(
        `family must be one of: ${FAUCET_FAMILIES.join(', ')}`,
      );
    }
    return this.faucetService.claim(wallet, family as ActionFamily);
  }
}
