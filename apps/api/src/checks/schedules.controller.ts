import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import {
  type CheckSchedule,
  createScheduleSchema,
  listSchedulesQuerySchema,
  pauseScheduleSchema,
  updateScheduleSchema,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { IdParam, ValidBody, ValidQuery } from '../common/validation.js';
import { SchedulesService } from './schedules.service.js';

@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @RequirePermissions('schedules.view')
  list(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(listSchedulesQuerySchema)
    query: z.output<typeof listSchedulesQuerySchema>,
  ): Promise<CheckSchedule[]> {
    return this.schedules.list(auth, query);
  }

  @Post()
  @RequirePermissions('schedules.manage_rules')
  create(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(createScheduleSchema) body: z.output<typeof createScheduleSchema>,
  ): Promise<CheckSchedule[]> {
    return this.schedules.create(auth, body);
  }

  @Get(':id')
  @RequirePermissions('schedules.view')
  get(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Schedule') id: string,
  ): Promise<CheckSchedule> {
    return this.schedules.get(auth, id);
  }

  @Put(':id')
  @RequirePermissions('schedules.manage_rules')
  update(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Schedule') id: string,
    @ValidBody(updateScheduleSchema) body: z.output<typeof updateScheduleSchema>,
  ): Promise<CheckSchedule> {
    return this.schedules.update(auth, id, body);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermissions('schedules.manage_rules')
  pause(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Schedule') id: string,
    @ValidBody(pauseScheduleSchema) body: z.output<typeof pauseScheduleSchema>,
  ): Promise<CheckSchedule> {
    return this.schedules.pause(auth, id, body.reason);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions('schedules.manage_rules')
  resume(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Schedule') id: string,
  ): Promise<CheckSchedule> {
    return this.schedules.resume(auth, id);
  }

  @Post(':id/end')
  @HttpCode(200)
  @RequirePermissions('schedules.manage_rules')
  end(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Schedule') id: string,
  ): Promise<CheckSchedule> {
    return this.schedules.end(auth, id);
  }
}
