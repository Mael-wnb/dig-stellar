// apps/api/src/modules/ops/ops.module.ts
import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

@Module({
  imports: [DbModule],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
