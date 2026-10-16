// apps/api/src/modules/campaign/auth.controller.ts
//
// Lot EP (EP1): wallet-ownership proof, two routes. ALWAYS ON — this is a
// primitive (a signed nonce verified with the public key), not a campaign
// feature, and the wallets recovery path (Gate 2 step 2) depends on it even
// while the campaign is dark. Thin validation only; the service decides.
// Failed proofs are 200s with a structured reason; 4xx = malformed input.
// Nothing here logs the message or the signature.

import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CampaignService } from './campaign.service';
import {
  optionalProvider,
  optionalUserId,
  requireAddress,
  requireNonce,
  requireSignedMessage,
} from './request-validation';

interface ChallengeBody {
  address?: string;
}

interface VerifyBody {
  address?: string;
  nonce?: string;
  signedMessage?: string;
  provider?: string;
  userId?: string;
}

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly campaign: CampaignService) {}

  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  challenge(@Body() body?: ChallengeBody) {
    return this.campaign.issueChallenge(requireAddress(body?.address));
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@Body() body?: VerifyBody) {
    return this.campaign.verifyChallenge({
      address: requireAddress(body?.address),
      nonce: requireNonce(body?.nonce),
      signedMessage: requireSignedMessage(body?.signedMessage),
      provider: optionalProvider(body?.provider),
      userId: optionalUserId(body?.userId),
    });
  }
}
