import { Module } from '@nestjs/common';
import { ActionsController } from './actions.controller';
import { ActionsService } from './actions.service';
import { WitnessController } from './witness.controller';
import { WitnessService } from './witness.service';
import { OpsModule } from '../ops/ops.module';

@Module({
  // OpsModule provides OpsService for E3 adoption-event recording.
  imports: [OpsModule],
  controllers: [ActionsController, WitnessController],
  providers: [ActionsService, WitnessService],
})
export class ActionsModule {}
