// apps/api/src/modules/campaign/campaign.module.ts
//
// Lot EP (EP1, EP2 social tasks): the Earn & Points campaign module. POINTS ONLY — no payout, no
// key, no token. ISOLATED by design (recon §6, faucet.module.ts pattern): this
// module imports NOTHING from the user action paths (modules/actions/**), the
// money path (modules/faucet/**) or the wallet layer (modules/wallets/**).
// It reads action_witnesses and user_wallets by SQL through CampaignRepository
// only. Inbound dependencies: the award script (84-campaign-award.ts) and the
// wallets recovery path (Gate 2 step 2) consume the exported CampaignRepository;
// nothing imports the controllers or the service.

import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { AuthController } from './auth.controller';
import { CampaignController } from './campaign.controller';
import { CampaignRepository } from './campaign.repository';
import { CampaignService } from './campaign.service';
import { CampaignSocialService } from './campaign-social.service';

@Module({
  imports: [DbModule],
  controllers: [AuthController, CampaignController],
  providers: [CampaignRepository, CampaignService, CampaignSocialService],
  // Repository only: the proof lookup/consume queries the wallets recovery
  // path needs, and the award script's SQL. Never the service or controllers.
  exports: [CampaignRepository],
})
export class CampaignModule {}
