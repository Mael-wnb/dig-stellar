// apps/api/src/modules/alerts/alerts.module.ts
//
// D2 alerting module. Lot 1 shipped AlertsRepository (also consumed by the
// indexer evaluator script). Lot 3 adds the rule CRUD HTTP surface
// (AlertsController + AlertsService), so the module is now registered in
// app.module. AlertsRepository stays exported for the evaluator wiring.

import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { AlertsController } from './alerts.controller';
import { NotificationsController } from './notifications.controller';
import { AlertsRepository } from './alerts.repository';
import { AlertsService } from './alerts.service';

@Module({
  imports: [DbModule],
  controllers: [AlertsController, NotificationsController],
  providers: [AlertsRepository, AlertsService],
  exports: [AlertsRepository],
})
export class AlertsModule {}
