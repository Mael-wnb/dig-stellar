// apps/api/src/modules/wallets/wallets.module.ts
import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
// Lot EP (Gate 2B): imported ONLY for the exported CampaignRepository (the
// wallet-ownership proof lookup/consume used by the no-session recovery path
// in WalletsService.connectWallet). CampaignModule never imports WalletsModule
// back, and nothing here touches the campaign service or controllers.
import { CampaignModule } from '../campaign/campaign.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [DbModule, CampaignModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}