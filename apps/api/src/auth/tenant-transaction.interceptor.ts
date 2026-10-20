import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { DataSource } from 'typeorm';
import { enterTenantRole, runInTenantContext } from '../database/db-context.js';
import { META } from './decorators.js';

/**
 * Runs each authenticated customer request in one transaction as
 * corecheck_app, scoped to the user's organisation. Everything the handler
 * does through TenantDb commits together or not at all, and row-level
 * security confines it to the organisation (TEN-004).
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const auth = context.switchToHttp().getRequest<Request>().auth;
    const skip = this.reflector.getAllAndOverride<boolean>(
      META.skipTenantTransaction,
      [context.getHandler(), context.getClass()],
    );
    if (!auth || skip) return next.handle();

    return from(
      this.dataSource.transaction(async (manager) => {
        await enterTenantRole(manager, auth.orgId, auth.userId);
        return runInTenantContext(
          { manager, orgId: auth.orgId, userId: auth.userId },
          () => lastValueFrom(next.handle(), { defaultValue: undefined }),
        );
      }),
    );
  }
}
