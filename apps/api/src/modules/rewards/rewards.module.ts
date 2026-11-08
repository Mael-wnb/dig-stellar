// apps/api/src/modules/rewards/rewards.module.ts
//
// Lot EP (EP5): daily XLM rewards on top of points. MONEY PATH — the second
// server-side payout key (docs/security-invariants.md §13). ISOLATED like the
// faucet: imports nothing from modules/faucet, modules/actions or
// modules/wallets. It imports CampaignModule for its REPOSITORY only (the
// campaign is where enrolments and points live) — the campaign module never
// imports anything from here. RewardsPayoutService (the only reader of the
// treasury secret env) is NOT exported: no other module can reach the key path.
// Inbound: OpsModule reads getOpsSnapshot() for /v1/ops/metrics; the award
// script constructs RewardsRepository directly (allocation only).

import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { CampaignModule } from '../campaign/campaign.module';
import { RewardsController } from './rewards.controller';
import { RewardsPayoutService } from './rewards-payout.service';
import { RewardsRepository } from './rewards.repository';
import { RewardsService } from './rewards.service';

@Module({
  imports: [DbModule, CampaignModule],
  controllers: [RewardsController],
  providers: [RewardsRepository, RewardsService, RewardsPayoutService],
  // RewardsService only (ops snapshot). Never the payout service.
  exports: [RewardsService],
})
export class RewardsModule {}
