// apps/api/src/modules/alerts/notifications.controller.ts
//
// D2 alerting — notifications read API (lot 4). Thin delegator like
// bridge.controller.ts: per-controller `v1/...` prefix, userId via @Query, limit
// parsed from the query string (clamped in the service/repo). All logic +
// ownership scoping live in AlertsService.
//
//   GET  /v1/notifications?userId=&limit=&before=   list (newest first)
//   GET  /v1/notifications/unread-count?userId=...   { count }
//   POST /v1/notifications/:id/read?userId=...        mark one read → 404 if not owned
//   POST /v1/notifications/read-all?userId=...        mark all read

import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AlertsService } from './alerts.service';

@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  listNotifications(
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string
  ) {
    const parsedLimit = limit !== undefined ? Number(limit) : undefined;
    return this.alertsService.listNotifications(userId, {
      limit: parsedLimit,
      before,
    });
  }

  @Get('unread-count')
  getUnreadCount(@Query('userId') userId?: string) {
    return this.alertsService.getUnreadCount(userId);
  }

  // Static path — declared distinct from ':id/read'; no route collision since
  // 'read-all' is a single segment.
  @Post('read-all')
  markAllRead(@Query('userId') userId?: string) {
    return this.alertsService.markAllRead(userId);
  }

  @Post(':id/read')
  markRead(@Param('id') id: string, @Query('userId') userId?: string) {
    return this.alertsService.markRead(userId, id);
  }
}
