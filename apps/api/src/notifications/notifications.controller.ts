import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import type { NotificationList } from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import {
  AllowReadOnlyOrg,
  CurrentAuth,
  RequirePermissions,
} from '../auth/decorators.js';
import { ValidBody } from '../common/validation.js';
import { NotificationsService } from './notifications.service.js';

const markReadSchema = z.object({
  ids: z.union([z.literal('all'), z.array(z.uuid()).min(1).max(100)]),
});

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions('notifications.view_own')
  list(@CurrentAuth() auth: CustomerAuth): Promise<NotificationList> {
    return this.notifications.list(auth);
  }

  @Post('read')
  @HttpCode(200)
  @AllowReadOnlyOrg()
  @RequirePermissions('notifications.view_own')
  markRead(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(markReadSchema) body: z.output<typeof markReadSchema>,
  ): Promise<NotificationList> {
    return this.notifications.markRead(auth, body.ids);
  }
}
