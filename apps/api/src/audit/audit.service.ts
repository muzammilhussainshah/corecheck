import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuditAction } from '@corecheck/shared';
import {
  type CustomerAuth,
  fullName,
  type StaffAuth,
} from '../auth/auth-context.js';
import type { ClientInfo } from '../common/request.js';

export interface AuditActor {
  type: 'user' | 'staff' | 'system';
  id: string | null;
  name: string | null;
}

export interface AuditRecord {
  /** tenant: visible to the organisation; platform: CoreCheck staff only. */
  scope: 'tenant' | 'platform';
  orgId: string | null;
  actor: AuditActor;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export const userActor = (auth: CustomerAuth): AuditActor => ({
  type: 'user',
  id: auth.userId,
  name: `${fullName(auth)} (${auth.username})`,
});

export const staffActor = (
  staff: Pick<StaffAuth, 'staffId' | 'name'>,
): AuditActor => ({
  type: 'staff',
  id: staff.staffId,
  name: `${staff.name} (CoreCheck)`,
});

export const clientMetadata = (
  client: ClientInfo,
): Record<string, unknown> => ({
  ip: client.ip,
  userAgent: client.userAgent,
});

/**
 * Writes audit history (AUD-001..004). Entries are written in the same
 * transaction as the change they describe, so either both are saved or
 * neither is. The table rejects updates and deletes.
 */
@Injectable()
export class AuditService {
  async record(manager: EntityManager, record: AuditRecord): Promise<void> {
    const json = (value: Record<string, unknown> | null | undefined) =>
      value == null ? null : JSON.stringify(value);
    await manager.query(
      `insert into corecheck.audit_events
         (scope, org_id, actor_type, actor_id, actor_name, action, entity_type,
          entity_id, summary, before, after, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb)`,
      [
        record.scope,
        record.orgId,
        record.actor.type,
        record.actor.id,
        record.actor.name,
        record.action,
        record.entityType ?? null,
        record.entityId ?? null,
        record.summary,
        json(record.before),
        json(record.after),
        json(record.metadata ?? {}),
      ],
    );
  }
}
