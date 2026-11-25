import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { DashboardSummary } from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { SqlParams } from '../common/sql.js';
import { TenantDb } from '../database/db-context.js';
import {
  COMPLIANCE_SQL,
  ComplianceService,
} from '../plants/compliance.service.js';
import { addDaysTo, checkRef } from './recurrence.js';

/** How far back "recent" reaches on the dashboard. */
const RECENT_DAYS = 7;

/**
 * The dashboard (FRD 6): plant awaiting reception or review and plant
 * Online/Offline (DSH-001/002), checks due today, this week and this month
 * with overdue work (DSH-004/005), recently completed checks with plant, type,
 * completer, time and result (DSH-006/007), open Defects by severity
 * (DSH-008), mandatory document exceptions (DSH-009), recent plant status
 * changes (DSH-010) and checks needing attention (DSH-011). Every figure is
 * counted within the user's scope (DSH-AC-02) with the same conditions the
 * list it opens uses (DSH-AC-01), in the organisation's time zone (DSH-AC-03).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly compliance: ComplianceService,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  async summary(auth: CustomerAuth): Promise<DashboardSummary> {
    const has = (code: Parameters<CustomerAuth['permissions']['has']>[0]) =>
      auth.permissions.has(code);
    const today = await this.compliance.today();
    const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const weekEnd = addDaysTo(today, 6 - weekday);
    const [y, m] = today.split('-').map(Number) as [number, number];
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const recentFrom = addDaysTo(today, -(RECENT_DAYS - 1));
    const scope = (params: SqlParams) =>
      auth.orgWideScope
        ? 'true'
        : `p.site_id = any(${params.add([...auth.siteIds])}::uuid[])`;

    let plant: DashboardSummary['plant'] = null;
    let documents: DashboardSummary['documents'] = null;
    const statusChanges: DashboardSummary['statusChanges'] = [];
    if (has('plant.view')) {
      const params = new SqlParams();
      const [row] = (await this.db.query(
        `select
           count(*) filter (where status = 'pending_reception')::int as "pendingReception",
           count(*) filter (where status = 'awaiting_approval')::int as "awaitingApproval",
           count(*) filter (where status = 'approved')::int as online,
           count(*) filter (where status = 'restricted')::int as offline
         from corecheck.plants p
        where p.archived_at is null and ${scope(params)}`,
        params.values,
      )) as [NonNullable<DashboardSummary['plant']>];
      plant = row;
      const changes = new SqlParams();
      const events = (await this.db.query(
        `select e.action, e.summary, e.actor_name as "by", e.occurred_at as at,
                p.id, p.asset_id as "assetId", p.name
           from corecheck.audit_events e
           join corecheck.plants p on p.id::text = e.entity_id
          where e.entity_type = 'plant'
            and e.action in ('plant.restricted', 'plant.returned_to_service',
                             'plant.approved', 'plant.defect_override')
            and ${scope(changes)}
          order by e.occurred_at desc
          limit 6`,
        changes.values,
      )) as Array<{
        action: string;
        summary: string;
        by: string | null;
        at: Date;
        id: string;
        assetId: string;
        name: string;
      }>;
      statusChanges.push(
        ...events.map((event) => ({
          plant: { id: event.id, assetId: event.assetId, name: event.name },
          action: event.action,
          summary: event.summary,
          by: event.by,
          at: new Date(event.at).toISOString(),
        })),
      );
    }
    if (has('documents.view')) {
      // The same conditions as the Plant Register's compliance filter and
      // the Documents page's state filters, so each count opens its list.
      const plantParams = new SqlParams();
      const [plantRow] = (await this.db.query(
        `select count(*)::int as n from corecheck.plants p
          where p.archived_at is null and ${scope(plantParams)}
            and (${COMPLIANCE_SQL}) = 'non_compliant'`,
        plantParams.values,
      )) as [{ n: number }];
      const docParams = new SqlParams();
      const [docRow] = (await this.db.query(
        `select
           count(*) filter (where s.state = 'expired')::int as expired,
           count(*) filter (where s.expires_soon
             and s.state in ('approaching_expiry', 'awaiting_verification'))::int as "approachingExpiry"
         from corecheck.plant_documents d
         join corecheck.plant_document_states s on s.document_id = d.id
         join corecheck.plant_document_versions v on v.id = d.current_version_id
         join corecheck.plants p on p.id = d.plant_id
         join corecheck.document_types t on t.id = d.document_type_id
        where p.archived_at is null and ${scope(docParams)}`,
        docParams.values,
      )) as [{ expired: number; approachingExpiry: number }];
      documents = {
        plantNotValid: plantRow.n,
        expired: docRow.expired,
        approachingExpiry: docRow.approachingExpiry,
      };
    }

    let checks: DashboardSummary['checks'] = null;
    let recentlyCompleted: DashboardSummary['recentlyCompleted'] = [];
    if (has('checks.view')) {
      const params = new SqlParams();
      const where = scope(params);
      const t = `${params.add(today)}::date`;
      const w = `${params.add(weekEnd)}::date`;
      const mEnd = `${params.add(monthEnd)}::date`;
      const since = `(${params.add(recentFrom)}::date::timestamp at time zone ${params.add(auth.org.timeZone)})`;
      const mine = `(c.assignee_user_id = ${params.add(auth.userId)}
        or c.assignee_team_id = any(${params.add([...auth.teamIds])}::uuid[])
        or c.assignee_discipline_id = any(${params.add([...auth.disciplineIds])}::uuid[]))`;
      const open = `c.status in ('due', 'in_progress', 'returned')`;
      const [row] = (await this.db.query(
        `select
           count(*) filter (where ${open} and ${mine})::int as mine,
           count(*) filter (where ${open} and c.due_on = ${t})::int as "dueToday",
           count(*) filter (where ${open} and c.due_on between ${t} and ${w})::int as "dueThisWeek",
           count(*) filter (where ${open} and c.due_on between ${t} and ${mEnd})::int as "dueThisMonth",
           count(*) filter (where ${open} and c.due_on < ${t})::int as overdue,
           count(*) filter (where c.status = 'submitted')::int as "awaitingReview",
           count(*) filter (where c.submitted_at >= ${since}
             and jsonb_array_length(c.outcome_reasons) > 0)::int as "failedRecently",
           count(*) filter (where c.submitted_at >= ${since}
             and exists (select 1 from corecheck.defects d where d.check_id = c.id))::int as "raisedDefectsRecently"
         from corecheck.checks c
         join corecheck.plants p on p.id = c.plant_id
        where ${where}`,
        params.values,
      )) as [NonNullable<DashboardSummary['checks']>];
      checks = row;
      const recent = new SqlParams();
      const rows = (await this.db.query(
        `select c.id, c.ref_no as "refNo", c.completed_at as "completedAt",
                jsonb_array_length(c.outcome_reasons)::int as failures,
                p.id as "plantId", p.asset_id as "assetId", p.name as "plantName",
                tp.name as template, tp.purpose,
                u.first_name || ' ' || u.last_name as "completedBy"
           from corecheck.checks c
           join corecheck.plants p on p.id = c.plant_id
           join corecheck.check_template_versions v on v.id = c.template_version_id
           join corecheck.check_templates tp on tp.id = v.template_id
           left join corecheck.users u on u.id = c.submitted_by
          where c.status = 'completed' and ${scope(recent)}
          order by c.completed_at desc
          limit 6`,
        recent.values,
      )) as Array<{
        id: string;
        refNo: number;
        completedAt: Date;
        failures: number;
        plantId: string;
        assetId: string;
        plantName: string;
        template: string;
        purpose: DashboardSummary['recentlyCompleted'][number]['purpose'];
        completedBy: string | null;
      }>;
      recentlyCompleted = rows.map((item) => ({
        id: item.id,
        ref: checkRef(item.refNo),
        plant: { id: item.plantId, assetId: item.assetId, name: item.plantName },
        template: item.template,
        purpose: item.purpose,
        completedBy: item.completedBy ?? 'Unknown',
        completedAt: new Date(item.completedAt).toISOString(),
        failures: item.failures,
      }));
    }

    let defects: DashboardSummary['defects'] = null;
    if (has('defects.view')) {
      const params = new SqlParams();
      const where = scope(params);
      const [row] = (await this.db.query(
        `select
           count(*) filter (where d.severity = 'minor')::int as minor,
           count(*) filter (where d.severity = 'major')::int as major,
           count(*) filter (where d.severity = 'critical')::int as critical,
           count(*) filter (where d.assignee_user_id = ${params.add(auth.userId)})::int as "assignedToMe"
         from corecheck.defects d
         join corecheck.plants p on p.id = d.plant_id
        where d.status <> 'closed' and ${where}`,
        params.values,
      )) as [NonNullable<DashboardSummary['defects']>];
      defects = row;
    }

    return {
      period: { today, weekEnd, monthEnd, recentFrom },
      plant,
      documents,
      checks,
      recentlyCompleted,
      defects,
      statusChanges,
    };
  }
}
