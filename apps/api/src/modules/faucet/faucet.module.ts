// apps/api/src/modules/faucet/faucet.module.ts
//
// R2 (Lot R — T3-D2): the reward-faucet module. ISOLATED by design (Lot R
// security model): imports nothing from the user action paths (modules/
// actions/**) and nothing there imports this. The ONLY inbound dependency is
// OpsModule reading the ops snapshot for drain visibility.
import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { FaucetController } from './faucet.controller';
import { FaucetService } from './faucet.service';
import { FaucetPayoutService } from './faucet-payout.service';

@Module({
  imports: [DbModule],
  controllers: [FaucetController],
  providers: [FaucetService, FaucetPayoutService],
  // Exported so OpsModule can surface treasury balance + claim counts in
  // /v1/ops/metrics (existing monitoring sees a drain).
  exports: [FaucetService],
})
export class FaucetModule {}
