// apps/api/src/modules/ops/ops.module.ts
import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { FaucetModule } from '../faucet/faucet.module';
import { RewardsModule } from '../rewards/rewards.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

@Module({
  // FaucetModule: R2 drain visibility — /v1/ops/metrics carries the faucet
  // block (treasury balance + claim counts). One-way dependency: the faucet
  // imports nothing back. RewardsModule (EP5): the same for the rewards
  // treasury (allocations / claims counts + balance).
  imports: [DbModule, FaucetModule, RewardsModule],
  controllers: [OpsController],
  providers: [OpsService],
  // Exported so ActionsModule can record adoption events (E3) on successful builds.
  exports: [OpsService],
})
export class OpsModule {}
