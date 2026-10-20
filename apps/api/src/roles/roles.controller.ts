import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  createRoleSchema,
  duplicateRoleSchema,
  listRolesQuerySchema,
  type RoleSummary,
  updateRoleSchema,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { IdParam, ValidBody, ValidQuery } from '../common/validation.js';
import { RolesService } from './roles.service.js';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Readable with roles.view or users.manage; checked in the service. */
  @Get()
  list(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(listRolesQuerySchema)
    query: z.output<typeof listRolesQuerySchema>,
  ): Promise<RoleSummary[]> {
    return this.roles.list(auth, query.includeArchived);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Role') id: string,
  ): Promise<RoleSummary> {
    return this.roles.get(auth, id);
  }

  @Post()
  @RequirePermissions('roles.manage')
  create(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(createRoleSchema) body: z.output<typeof createRoleSchema>,
  ): Promise<RoleSummary> {
    return this.roles.create(auth, body);
  }

  @Post(':id/duplicate')
  @RequirePermissions('roles.manage')
  duplicate(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Role') id: string,
    @ValidBody(duplicateRoleSchema) body: z.output<typeof duplicateRoleSchema>,
  ): Promise<RoleSummary> {
    return this.roles.duplicate(auth, id, body);
  }

  @Patch(':id')
  @RequirePermissions('roles.manage')
  update(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Role') id: string,
    @ValidBody(updateRoleSchema) body: z.output<typeof updateRoleSchema>,
  ): Promise<RoleSummary> {
    return this.roles.update(auth, id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('roles.manage')
  archive(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Role') id: string,
  ): Promise<RoleSummary> {
    return this.roles.archive(auth, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('roles.manage')
  restore(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('Role') id: string,
  ): Promise<RoleSummary> {
    return this.roles.restore(auth, id);
  }
}
