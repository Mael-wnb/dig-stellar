// apps/api/src/modules/ops/ops.module.ts
import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { FaucetModule } from '../faucet/faucet.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

@Module({
  // FaucetModule: R2 drain visibility — /v1/ops/metrics carries the faucet
  // block (treasury balance + claim counts). One-way dependency: the faucet
  // imports nothing back.
  imports: [DbModule, FaucetModule],
  controllers: [OpsController],
  providers: [OpsService],
  // Exported so ActionsModule can record adoption events (E3) on successful builds.
  exports: [OpsService],
})
export class OpsModule {}
