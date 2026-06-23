// apps/api/src/modules/bridge/bridge.module.ts
import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { BridgeController } from './bridge.controller';
import { BridgeService } from './bridge.service';

@Module({
  imports: [DbModule],
  controllers: [BridgeController],
  providers: [BridgeService],
})
export class BridgeModule {}
