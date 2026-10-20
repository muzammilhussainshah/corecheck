import { Controller, Get } from '@nestjs/common';
import type { z } from 'zod';
import {
  type AuditEvent,
  listAuditQuerySchema,
  type Paginated,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermissions } from '../auth/decorators.js';
import { ValidQuery } from '../common/validation.js';
import { TenantDb } from '../database/db-context.js';
import { listAuditEvents } from './audit-query.js';

/** The organisation's security audit history (Admin only by default). */
@Controller('audit-events')
export class AuditController {
  constructor(private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermissions('audit.view_security')
  list(
    @CurrentAuth() auth: CustomerAuth,
    @ValidQuery(listAuditQuerySchema)
    query: z.output<typeof listAuditQuerySchema>,
  ): Promise<Paginated<AuditEvent>> {
    return listAuditEvents(this.tenantDb.manager, query, auth.org.timeZone);
  }
}
