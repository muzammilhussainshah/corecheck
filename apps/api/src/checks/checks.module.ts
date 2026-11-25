import { Module } from '@nestjs/common';
import { PlantsModule } from '../plants/plants.module.js';
import { TemplatesModule } from '../templates/templates.module.js';
import { CheckExportService } from './check-export.service.js';
import { ChecksController } from './checks.controller.js';
import { ChecksService } from './checks.service.js';
import { DashboardService } from './dashboard.service.js';
import { DefectsController } from './defects.controller.js';
import { DefectsService } from './defects.service.js';
import { ListExportService } from './list-export.service.js';
import { ScheduleSweepService } from './schedule-sweep.service.js';
import { SchedulesController } from './schedules.controller.js';
import { SchedulesService } from './schedules.service.js';

/** Schedules, checks and Defects (FRD 11, 12, 13). */
@Module({
  imports: [PlantsModule, TemplatesModule],
  controllers: [SchedulesController, ChecksController, DefectsController],
  providers: [
    SchedulesService,
    ScheduleSweepService,
    ChecksService,
    CheckExportService,
    DashboardService,
    DefectsService,
    ListExportService,
  ],
  exports: [ScheduleSweepService],
})
export class ChecksModule {}
