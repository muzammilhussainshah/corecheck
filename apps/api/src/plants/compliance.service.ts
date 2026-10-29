import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  COMPLIANT_DOCUMENT_STATES,
  DOCUMENT_STATE_LABELS,
  type DocumentRequirement,
  type DocumentState,
  type PlantCompliance,
  type PlantComplianceState,
} from '@corecheck/shared';
import { type AuditActor, AuditService } from '../audit/audit.service.js';
import { Clock } from '../common/clock.js';
import { PlantEntity, UserEntity } from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';

interface RequirementRow {
  plantId: string;
  documentTypeId: string;
  documentTypeName: string;
  state: DocumentState;
}

/** The SQL for a plant's standing, for list queries over "p" (plants). */
export const COMPLIANCE_SQL = `
  case
    when not exists (select 1 from corecheck.plant_requirement_states r
                      where r.plant_id = p.id) then 'not_required'
    when exists (select 1 from corecheck.plant_requirement_states r
                  where r.plant_id = p.id
                    and r.state not in ('valid', 'approaching_expiry')) then 'non_compliant'
    when exists (select 1 from corecheck.plant_requirement_states r
                  where r.plant_id = p.id
                    and r.state = 'approaching_expiry') then 'expiring'
    else 'compliant'
  end`;

const isCompliant = (state: DocumentState) =>
  COMPLIANT_DOCUMENT_STATES.includes(state);

/** How a set of requirements adds up for the plant (PLR-001). */
export const complianceState = (
  states: DocumentState[],
): PlantComplianceState => {
  if (states.length === 0) return 'not_required';
  if (states.some((state) => !isCompliant(state))) return 'non_compliant';
  if (states.includes('approaching_expiry')) return 'expiring';
  return 'compliant';
};

/**
 * Mandatory documents and what they mean for plant (FRD 9): missing,
 * expired, rejected or unverified mandatory documents keep plant from being
 * approved (DOC-006) and take approved plant out of use, unless an
 * authorised override is still within its review date (DOC-008).
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  async requirements(plantId: string): Promise<DocumentRequirement[]> {
    const rows = await this.requirementRows([plantId]);
    return rows.map((row) => ({
      documentType: { id: row.documentTypeId, name: row.documentTypeName },
      state: row.state,
    }));
  }

  async forPlant(plant: PlantEntity): Promise<PlantCompliance> {
    const requirements = await this.requirements(plant.id);
    const today = await this.today();
    const override =
      plant.complianceOverrideUntil && plant.complianceOverrideUntil >= today
        ? {
            until: plant.complianceOverrideUntil,
            note: plant.complianceOverrideNote ?? '',
            by: await this.nameOf(plant.complianceOverrideBy),
          }
        : null;
    return {
      state: complianceState(requirements.map((item) => item.state)),
      requirements,
      override,
    };
  }

  /** "LOLER (Expired), Insurance (Missing)": what stops plant going Online. */
  async blockers(plantId: string): Promise<string[]> {
    return (await this.requirementRows([plantId]))
      .filter((row) => !isCompliant(row.state))
      .map(
        (row) =>
          `${row.documentTypeName} (${DOCUMENT_STATE_LABELS[row.state]})`,
      );
  }

  /** Today in the organisation's time zone, as YYYY-MM-DD. */
  async today(): Promise<string> {
    const [row] = (await this.db.query(
      `select to_char((now() at time zone time_zone)::date, 'YYYY-MM-DD') as today
         from corecheck.organisations where id = corecheck.current_org_id()`,
    )) as [{ today: string }];
    return row.today;
  }

  /**
   * Takes approved plant out of use when its mandatory documents are no
   * longer valid (DOC-AC-01). Runs after every document change and on a
   * schedule for expiry; `plantIds` narrows it to the plant just changed.
   * Lifting the restriction stays a deliberate return to service.
   */
  async enforce(actor: AuditActor, plantIds?: string[]): Promise<number> {
    const params: unknown[] = [];
    let narrow = '';
    if (plantIds) {
      if (plantIds.length === 0) return 0;
      params.push(plantIds);
      narrow = 'and p.id = any($1::uuid[])';
    }
    const candidates = (await this.db.query(
      `select p.id
         from corecheck.plants p
         join corecheck.organisations o on o.id = p.org_id
        where p.status = 'approved' and p.archived_at is null ${narrow}
          and (p.compliance_override_until is null
               or p.compliance_override_until < (now() at time zone o.time_zone)::date)
          and exists (select 1 from corecheck.plant_requirement_states r
                       where r.plant_id = p.id
                         and r.state not in ('valid', 'approaching_expiry'))`,
      params,
    )) as Array<{ id: string }>;
    if (candidates.length === 0) return 0;

    const reasons = new Map<string, string[]>();
    for (const row of await this.requirementRows(candidates.map((c) => c.id))) {
      if (isCompliant(row.state)) continue;
      const list = reasons.get(row.plantId) ?? [];
      list.push(
        `${row.documentTypeName} (${DOCUMENT_STATE_LABELS[row.state]})`,
      );
      reasons.set(row.plantId, list);
    }

    for (const { id } of candidates) {
      const plant = await this.db.findOneByOrFail(PlantEntity, { id });
      const documents = reasons.get(id) ?? [];
      const note = `Mandatory documents not valid: ${documents.join(', ')}`;
      await this.db.update(
        PlantEntity,
        { id },
        {
          status: 'restricted',
          restrictionReason: null,
          statusNote: note,
          statusChangedAt: this.clock.now(),
          statusChangedBy: actor.type === 'user' ? actor.id : null,
        },
      );
      await this.audit.record(this.db, {
        scope: 'tenant',
        orgId: this.tenantDb.orgId,
        actor,
        action: 'plant.restricted',
        entityType: 'plant',
        entityId: id,
        summary: `Restricted ${plant.assetId} ${plant.name}: mandatory documents not valid`,
        before: { status: plant.status },
        after: { status: 'restricted', note },
        metadata: { automatic: true, documents },
      });
    }
    return candidates.length;
  }

  private async requirementRows(plantIds: string[]): Promise<RequirementRow[]> {
    return (await this.db.query(
      `select plant_id as "plantId", document_type_id as "documentTypeId",
              document_type_name as "documentTypeName", state
         from corecheck.plant_requirement_states
        where plant_id = any($1::uuid[])
        order by lower(document_type_name)`,
      [plantIds],
    )) as RequirementRow[];
  }

  private async nameOf(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const user = await this.db.findOneBy(UserEntity, { id: userId });
    return user ? `${user.firstName} ${user.lastName}` : null;
  }
}
