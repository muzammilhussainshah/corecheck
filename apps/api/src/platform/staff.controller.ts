import { Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  createStaffSchema,
  resetStaffCredentialsSchema,
  type StaffMember,
  type StaffWithPassword,
  updateStaffSchema,
} from '@corecheck/shared';
import type { StaffAuth } from '../auth/auth-context.js';
import {
  CurrentStaff,
  RequireStaffRoles,
  StaffArea,
} from '../auth/decorators.js';
import { clientInfo } from '../common/request.js';
import { IdParam, ValidBody } from '../common/validation.js';
import { StaffService } from './staff.service.js';

@StaffArea()
@RequireStaffRoles('owner')
@Controller('platform/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@CurrentStaff() auth: StaffAuth): Promise<StaffMember[]> {
    return this.staff.list(auth);
  }

  @Post()
  create(
    @CurrentStaff() auth: StaffAuth,
    @ValidBody(createStaffSchema) body: z.output<typeof createStaffSchema>,
    @Req() req: Request,
  ): Promise<StaffWithPassword> {
    return this.staff.create(auth, body, clientInfo(req));
  }

  @Patch(':id')
  update(
    @CurrentStaff() auth: StaffAuth,
    @IdParam('Staff member') id: string,
    @ValidBody(updateStaffSchema) body: z.output<typeof updateStaffSchema>,
    @Req() req: Request,
  ): Promise<StaffMember> {
    return this.staff.update(auth, id, body, clientInfo(req));
  }

  @Post(':id/disable')
  @HttpCode(200)
  disable(
    @CurrentStaff() auth: StaffAuth,
    @IdParam('Staff member') id: string,
    @Req() req: Request,
  ): Promise<StaffMember> {
    return this.staff.setActive(auth, id, false, clientInfo(req));
  }

  @Post(':id/enable')
  @HttpCode(200)
  enable(
    @CurrentStaff() auth: StaffAuth,
    @IdParam('Staff member') id: string,
    @Req() req: Request,
  ): Promise<StaffMember> {
    return this.staff.setActive(auth, id, true, clientInfo(req));
  }

  @Post(':id/reset-credentials')
  @HttpCode(200)
  resetCredentials(
    @CurrentStaff() auth: StaffAuth,
    @IdParam('Staff member') id: string,
    @ValidBody(resetStaffCredentialsSchema)
    body: z.output<typeof resetStaffCredentialsSchema>,
    @Req() req: Request,
  ): Promise<StaffWithPassword> {
    return this.staff.resetCredentials(
      auth,
      id,
      body.resetMfa,
      clientInfo(req),
    );
  }
}
