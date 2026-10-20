import { Controller, Get } from '@nestjs/common';
import type { z } from 'zod';
import {
  type AuditEvent,
  listAuditQuerySchema,
  type Paginated,
} from '@corecheck/shared';
import { listAuditEvents } from '../audit/audit-query.js';
import type { StaffAuth } from '../auth/auth-context.js';
import { CurrentStaff, StaffArea } from '../auth/decorators.js';
import { ValidQuery } from '../common/validation.js';
import { PlatformDb } from '../database/db-context.js';

/** Internal security and provisioning records (IAD-004). Dates are UTC. */
@StaffArea()
@Controller('platform/audit-events')
export class PlatformAuditController {
  constructor(private readonly platformDb: PlatformDb) {}

  @Get()
  list(
    @CurrentStaff() staff: StaffAuth,
    @ValidQuery(listAuditQuerySchema)
    query: z.output<typeof listAuditQuerySchema>,
  ): Promise<Paginated<AuditEvent>> {
    return this.platformDb.transaction(staff.staffId, (manager) =>
      listAuditEvents(manager, query, 'UTC'),
    );
  }
}
