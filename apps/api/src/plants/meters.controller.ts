import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  correctMeterReadingSchema,
  createMeterReadingSchema,
  type PlantMeters,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { IdParam, ValidBody } from '../common/validation.js';
import { MetersService } from './meters.service.js';

@Controller()
export class MetersController {
  constructor(private readonly meters: MetersService) {}

  @Get('plants/:id/meters')
  @RequirePermissions('plant.view', 'meters.record')
  forPlant(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') plantId: string,
  ): Promise<PlantMeters> {
    return this.meters.forPlant(auth, plantId);
  }

  @Post('plants/:id/meters')
  @RequirePermissions('plant.view', 'meters.record')
  record(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Plant') plantId: string,
    @ValidBody(createMeterReadingSchema)
    body: z.output<typeof createMeterReadingSchema>,
  ): Promise<PlantMeters> {
    return this.meters.record(auth, plantId, body);
  }

  @Post('meter-readings/:id/correct')
  @HttpCode(200)
  @RequirePermissions('meters.correct')
  correct(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Reading') id: string,
    @ValidBody(correctMeterReadingSchema)
    body: z.output<typeof correctMeterReadingSchema>,
  ): Promise<PlantMeters> {
    return this.meters.correct(auth, id, body.value, body.reason);
  }
}
