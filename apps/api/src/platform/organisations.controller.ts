import { Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  type CreateOrganisationResponse,
  createOrganisationSchema,
  type IssuedCredentials,
  listOrganisationsQuerySchema,
  type OrganisationAdmin,
  type OrganisationDetail,
  organisationStatusChangeSchema,
  type OrganisationSummary,
  type Paginated,
  updateOrganisationSchema,
} from '@corecheck/shared';
import type { StaffAuth } from '../auth/auth-context.js';
import {
  CurrentStaff,
  RequireStaffRoles,
  StaffArea,
} from '../auth/decorators.js';
import { clientInfo } from '../common/request.js';
import { IdParam, ValidBody, ValidQuery } from '../common/validation.js';
import {
  OrganisationsService,
  type StatusAction,
} from './organisations.service.js';

type StatusChange = z.output<typeof organisationStatusChangeSchema>;

@StaffArea()
@Controller('platform/organisations')
export class OrganisationsController {
  constructor(private readonly organisations: OrganisationsService) {}

  @Get()
  list(
    @CurrentStaff() staff: StaffAuth,
    @ValidQuery(listOrganisationsQuerySchema)
    query: z.output<typeof listOrganisationsQuerySchema>,
  ): Promise<Paginated<OrganisationSummary>> {
    return this.organisations.list(staff, query);
  }

  @Post()
  @RequireStaffRoles('owner', 'admin')
  create(
    @CurrentStaff() staff: StaffAuth,
    @ValidBody(createOrganisationSchema)
    body: z.output<typeof createOrganisationSchema>,
    @Req() req: Request,
  ): Promise<CreateOrganisationResponse> {
    return this.organisations.create(staff, body, clientInfo(req));
  }

  @Get(':id')
  get(
    @CurrentStaff() staff: StaffAuth,
    @IdParam('Organisation') id: string,
  ): Promise<OrganisationDetail> {
    return this.organisations.get(staff, id);
  }

  @Patch(':id')
  @RequireStaffRoles('owner', 'admin')
  update(
    @CurrentStaff() staff: StaffAuth,
    @IdParam('Organisation') id: string,
    @ValidBody(updateOrganisationSchema)
    body: z.output<typeof updateOrganisationSchema>,
    @Req() req: Request,
  ): Promise<OrganisationDetail> {
    return this.organisations.update(staff, id, body, clientInfo(req));
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequireStaffRoles('owner', 'admin')
  suspend(
    @CurrentStaff() staff: StaffAuth,
    @IdParam('Organisation') id: string,
    @ValidBody(organisationStatusChangeSchema) body: StatusChange,
    @Req() req: Request,
  ): Promise<OrganisationDetail> {
    return this.changeStatus(staff, id, 'suspend', body, req);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequireStaffRoles('owner', 'admin')
  activate(
    @CurrentStaff() staff: StaffAuth,
    @IdParam('Organisation') id: string,
    @ValidBody(organisationStatusChangeSchema) body: StatusChange,
    @Req() req: Request,
  ): Promise<OrganisationDetail> {
    return this.changeStatus(staff, id, 'activate', body, req);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequireStaffRoles('owner', 'admin')
  archive(
    @CurrentStaff() staff: StaffAuth,
    @IdParam('Organisation') id: string,
    @ValidBody(organisationStatusChangeSchema) body: StatusChange,
    @Req() req: Request,
  ): Promise<OrganisationDetail> {
    return this.changeStatus(staff, id, 'archive', body, req);
  }

  @Get(':id/admins')
  admins(
    @CurrentStaff() staff: StaffAuth,
    @IdParam('Organisation') id: string,
  ): Promise<OrganisationAdmin[]> {
    return this.organisations.listAdmins(staff, id);
  }

  @Post(':id/admins/:userId/reset-pin')
  @HttpCode(200)
  @RequireStaffRoles('owner', 'admin')
  resetAdminPin(
    @CurrentStaff() staff: StaffAuth,
    @IdParam('Organisation') id: string,
    @IdParam('Organisation Admin', 'userId') userId: string,
    @Req() req: Request,
  ): Promise<{ admin: OrganisationAdmin; credentials: IssuedCredentials }> {
    return this.organisations.resetAdminPin(staff, id, userId, clientInfo(req));
  }

  @Post(':id/admins/:userId/unlock')
  @HttpCode(200)
  @RequireStaffRoles('owner', 'admin')
  unlockAdmin(
    @CurrentStaff() staff: StaffAuth,
    @IdParam('Organisation') id: string,
    @IdParam('Organisation Admin', 'userId') userId: string,
    @Req() req: Request,
  ): Promise<OrganisationAdmin> {
    return this.organisations.unlockAdmin(staff, id, userId, clientInfo(req));
  }

  private changeStatus(
    staff: StaffAuth,
    id: string,
    action: StatusAction,
    body: StatusChange,
    req: Request,
  ): Promise<OrganisationDetail> {
    return this.organisations.changeStatus(
      staff,
      id,
      action,
      body.reason,
      clientInfo(req),
    );
  }
}
