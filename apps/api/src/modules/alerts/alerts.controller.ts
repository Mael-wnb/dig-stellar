// apps/api/src/modules/alerts/alerts.controller.ts
//
// D2 alerting — rule CRUD endpoints (lot 3). Thin delegator, like
// wallets.controller.ts: per-controller `v1/...` prefix, userId via @Query (with
// @Body fallback for writes), all validation/ownership in AlertsService.
//
//   POST   /v1/alert-rules?userId=...      create
//   GET    /v1/alert-rules?userId=...      list the user's rules
//   GET    /v1/alert-rules/:id?userId=...  one rule (404 if not owned)
//   PATCH  /v1/alert-rules/:id?userId=...  partial update (404 if not owned)
//   DELETE /v1/alert-rules/:id?userId=...  delete (404 if not owned)

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AlertsService,
  type CreateAlertRuleBody,
  type UpdateAlertRuleBody,
} from './alerts.service';

@Controller('v1/alert-rules')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post()
  createRule(
    @Query('userId') queryUserId?: string,
    @Body() body?: CreateAlertRuleBody
  ) {
    return this.alertsService.createRule(queryUserId, body ?? {});
  }

  @Get()
  listRules(@Query('userId') userId?: string) {
    return this.alertsService.listRules(userId);
  }

  @Get(':id')
  getRule(@Param('id') id: string, @Query('userId') userId?: string) {
    return this.alertsService.getRule(userId, id);
  }

  @Patch(':id')
  updateRule(
    @Param('id') id: string,
    @Query('userId') queryUserId?: string,
    @Body() body?: UpdateAlertRuleBody
  ) {
    return this.alertsService.updateRule(queryUserId, id, body ?? {});
  }

  @Delete(':id')
  deleteRule(@Param('id') id: string, @Query('userId') queryUserId?: string) {
    return this.alertsService.deleteRule(queryUserId, id);
  }
}
