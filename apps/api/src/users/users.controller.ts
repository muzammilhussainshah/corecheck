import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  createUserSchema,
  listUsersQuerySchema,
  type Paginated,
  type SeatUsage,
  updateUserSchema,
  type UserDetail,
  type UserSummary,
  type UserWithCredentials,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { IdParam, ValidBody, ValidQuery } from '../common/validation.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.view')
  list(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(listUsersQuerySchema)
    query: z.output<typeof listUsersQuerySchema>,
  ): Promise<Paginated<UserSummary>> {
    return this.users.list(auth, query);
  }

  @Get('seat-usage')
  @RequirePermissions('users.view')
  seatUsage(): Promise<SeatUsage> {
    return this.users.seatUsage();
  }

  @Post()
  @RequirePermissions('users.manage')
  create(
    @CurrentAuth() auth: CustomerAuth,
    @ValidBody(createUserSchema) body: z.output<typeof createUserSchema>,
  ): Promise<UserWithCredentials> {
    return this.users.create(auth, body);
  }

  @Get(':id')
  @RequirePermissions('users.view')
  get(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('User') id: string,
  ): Promise<UserDetail> {
    return this.users.get(auth, id);
  }

  /** Field-level permissions are checked in the service. */
  @Patch(':id')
  update(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('User') id: string,
    @ValidBody(updateUserSchema) body: z.output<typeof updateUserSchema>,
  ): Promise<UserDetail> {
    return this.users.update(auth, id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions('users.manage')
  deactivate(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('User') id: string,
  ): Promise<UserDetail> {
    return this.users.deactivate(auth, id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermissions('users.manage')
  reactivate(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('User') id: string,
  ): Promise<UserDetail> {
    return this.users.reactivate(auth, id);
  }

  @Post(':id/reset-pin')
  @HttpCode(200)
  @RequirePermissions('users.reset_pin')
  resetPin(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('User') id: string,
  ): Promise<UserWithCredentials> {
    return this.users.resetPin(auth, id);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @RequirePermissions('users.reset_pin')
  unlock(
    @CurrentAuth() auth: CustomerAuth,
    @IdParam('User') id: string,
  ): Promise<UserDetail> {
    return this.users.unlock(auth, id);
  }
}
