import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { PeopleService } from './people.service.js';

/** Notifications and recipient lookup, used by plant, check and Defect work. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, PeopleService],
  exports: [NotificationsService, PeopleService],
})
export class NotificationsModule {}
