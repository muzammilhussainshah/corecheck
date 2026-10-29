import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import type {
  AuditEvent,
  listAuditQuerySchema,
  Paginated,
} from '@corecheck/shared';
import { escapeLike, SqlParams } from '../common/sql.js';

type AuditQuery = z.output<typeof listAuditQuerySchema>;

interface AuditRow {
  id: string;
  occurredAt: Date;
  actorType: AuditEvent['actorType'];
  actorName: string | null;
  organisationName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  total: string;
}

/**
 * A page of audit history, newest first. Row-level security already limits
 * the rows to what the calling role may see (the organisation's tenant events,
 * or platform events for staff); `timeZone` decides which calendar day the
 * from/to filters mean. `entity` narrows it to one record's history, such as
 * a plant's (PLR-003).
 */
export const listAuditEvents = async (
  manager: EntityManager,
  query: AuditQuery,
  timeZone: string,
  entity?: { type: string; id: string },
): Promise<Paginated<AuditEvent>> => {
  const params = new SqlParams();
  const where: string[] = [];

  if (entity) {
    where.push(
      `e.entity_type = ${params.add(entity.type)} and e.entity_id = ${params.add(entity.id)}`,
    );
  }

  if (query.category) {
    where.push(
      `e.action like ${params.add(`${escapeLike(query.category)}.%`)}`,
    );
  }
  if (query.search) {
    const term = params.add(`%${escapeLike(query.search)}%`);
    where.push(`(e.summary ilike ${term} or e.actor_name ilike ${term})`);
  }
  if (query.from || query.to) {
    const tz = `${params.add(timeZone)}::text`;
    if (query.from) {
      where.push(
        `e.occurred_at >= (${params.add(query.from)}::date)::timestamp at time zone ${tz}`,
      );
    }
    if (query.to) {
      where.push(
        `e.occurred_at < (${params.add(query.to)}::date + 1)::timestamp at time zone ${tz}`,
      );
    }
  }

  const limit = params.add(query.pageSize);
  const offset = params.add((query.page - 1) * query.pageSize);
  const rows = (await manager.query(
    `select e.id::text as id, e.occurred_at as "occurredAt", e.actor_type as "actorType",
            e.actor_name as "actorName", o.name as "organisationName", e.action,
            e.entity_type as "entityType", e.entity_id as "entityId", e.summary,
            e.before, e.after, e.metadata, count(*) over () as total
       from corecheck.audit_events e
       left join corecheck.organisations o on o.id = e.org_id
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by e.occurred_at desc, e.id desc
      limit ${limit} offset ${offset}`,
    params.values,
  )) as AuditRow[];

  return {
    items: rows.map(({ total: _total, occurredAt, ...row }) => ({
      ...row,
      occurredAt: occurredAt.toISOString(),
    })),
    total: rows.length ? Number(rows[0]!.total) : 0,
    page: query.page,
    pageSize: query.pageSize,
  };
};
