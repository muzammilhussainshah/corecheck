import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import {
  type AuditAction,
  type AuditEvent,
  type createPlantSchema,
  type CustomValue,
  ERROR_CODES,
  type IdName,
  type listAuditQuerySchema,
  type listPlantsQuerySchema,
  OWNERSHIP_COMPANY_KIND,
  type Paginated,
  type PlantDetail,
  type PlantDuplicates,
  type PlantSaved,
  type PlantSummary,
  type restrictPlantSchema,
  type returnToServiceSchema,
  type updatePlantSchema,
} from '@corecheck/shared';
import { listAuditEvents } from '../audit/audit-query.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { type CustomerAuth, fullName } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import {
  AppException,
  conflict,
  fieldError,
  forbidden,
  notFound,
  outOfScope,
} from '../common/errors.js';
import { escapeLike, SqlParams } from '../common/sql.js';
import {
  AreaEntity,
  DisciplineEntity,
  PlantCategoryEntity,
  PlantCompanyEntity,
  PlantCustomFieldEntity,
  PlantDisciplineEntity,
  PlantEntity,
  PlantTypeEntity,
  SiteEntity,
  UserEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { COMPLIANCE_SQL, ComplianceService } from './compliance.service.js';

type CreateInput = z.output<typeof createPlantSchema>;
type UpdateInput = z.output<typeof updatePlantSchema>;
type ListQuery = z.output<typeof listPlantsQuerySchema>;
type ListFilters = Omit<ListQuery, 'page' | 'pageSize'>;
type RestrictInput = z.output<typeof restrictPlantSchema>;
type ReturnInput = z.output<typeof returnToServiceSchema>;
type HistoryQuery = z.output<typeof listAuditQuerySchema>;

/** The register row: the plant with the names it refers to. */
const PLANT_SELECT = `
  select p.id, p.asset_id as "assetId", p.plant_number as "plantNumber",
         p.serial_number as "serialNumber", p.name, p.make, p.model,
         p.ownership, p.status, p.restriction_reason as "restrictionReason",
         p.archived_at as "archivedAt", p.updated_at as "updatedAt",
         p.site_id as "siteId", s.name as "siteName",
         p.plant_type_id as "typeId", t.name as "typeName",
         p.category_id as "categoryId", c.name as "categoryName",
         p.company_id as "companyId", co.name as "companyName",
         p.area_id as "areaId", a.name as "areaName",
         ${COMPLIANCE_SQL} as compliance
    from corecheck.plants p
    join corecheck.plant_types t on t.id = p.plant_type_id
    join corecheck.plant_companies co on co.id = p.company_id
    join corecheck.sites s on s.id = p.site_id
    left join corecheck.plant_categories c on c.id = p.category_id
    left join corecheck.site_areas a on a.id = p.area_id`;

interface PlantRow {
  id: string;
  assetId: string;
  plantNumber: string | null;
  serialNumber: string | null;
  name: string;
  make: string | null;
  model: string | null;
  ownership: PlantSummary['ownership'];
  status: PlantSummary['status'];
  restrictionReason: PlantSummary['restrictionReason'];
  archivedAt: Date | null;
  updatedAt: Date;
  siteId: string;
  siteName: string;
  typeId: string;
  typeName: string;
  categoryId: string | null;
  categoryName: string | null;
  companyId: string;
  companyName: string;
  areaId: string | null;
  areaName: string | null;
  compliance: PlantSummary['compliance'];
}

const SORT_COLUMNS: Record<ListQuery['sort'], string> = {
  assetId: 'lower(p.asset_id)',
  name: 'lower(p.name)',
  status: 'p.status',
  site: 'lower(s.name)',
  type: 'lower(t.name)',
  updatedAt: 'p.updated_at',
};

const toSummary = (row: PlantRow): PlantSummary => ({
  id: row.id,
  assetId: row.assetId,
  plantNumber: row.plantNumber,
  serialNumber: row.serialNumber,
  name: row.name,
  plantType: { id: row.typeId, name: row.typeName },
  category: row.categoryId
    ? { id: row.categoryId, name: row.categoryName! }
    : null,
  make: row.make,
  model: row.model,
  ownership: row.ownership,
  company: { id: row.companyId, name: row.companyName },
  site: { id: row.siteId, name: row.siteName },
  area: row.areaId ? { id: row.areaId, name: row.areaName! } : null,
  status: row.status,
  restrictionReason: row.restrictionReason,
  compliance: row.compliance,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
});

/** Blank optional text is stored as null. */
const blankToNull = (value: string | undefined): string | null | undefined =>
  value === undefined ? undefined : value === '' ? null : value;

/** A new System Asset ID for generated identifiers (PLT-002). */
const formatAssetId = (value: number): string =>
  `PLT-${String(value).padStart(6, '0')}`;

/**
 * The Plant Register (FRD 7): one record per System Asset ID, kept within the
 * signed-in user's sites. Operatives may register plant and edit it while it
 * is their own Pending Reception record (PLC-003, PLC-004); everything after
 * that needs the matching permission.
 */
@Injectable()
export class PlantsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly compliance: ComplianceService,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  // ------------------------------------------------------------------ read

  async list(
    auth: CustomerAuth,
    query: ListQuery,
  ): Promise<Paginated<PlantSummary>> {
    const params = new SqlParams();
    const where = this.filterConditions(auth, query, params);
    const [{ total }] = (await this.db.query(
      `select count(*)::int as total
         from corecheck.plants p
         join corecheck.plant_types t on t.id = p.plant_type_id
         join corecheck.sites s on s.id = p.site_id
        where ${where}`,
      params.values,
    )) as [{ total: number }];
    const rows = (await this.db.query(
      `${PLANT_SELECT}
        where ${where}
        order by ${SORT_COLUMNS[query.sort]} ${query.order}, p.id
        limit ${params.add(query.pageSize)} offset ${params.add((query.page - 1) * query.pageSize)}`,
      params.values,
    )) as PlantRow[];
    return {
      items: rows.map(toSummary),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Every plant matching the filters, for exports and label sheets. */
  async listAll(
    auth: CustomerAuth,
    filters: ListFilters,
    limit: number,
    ids?: string[],
  ): Promise<PlantSummary[]> {
    const params = new SqlParams();
    const where = ids
      ? `${this.scopeCondition(auth, params)} and p.id = any(${params.add(ids)}::uuid[])`
      : this.filterConditions(auth, filters, params);
    const rows = (await this.db.query(
      `${PLANT_SELECT}
        where ${where}
        order by ${SORT_COLUMNS[filters.sort]} ${filters.order}, p.id
        limit ${params.add(limit)}`,
      params.values,
    )) as PlantRow[];
    return rows.map(toSummary);
  }

  async get(auth: CustomerAuth, id: string): Promise<PlantDetail> {
    return this.detail(auth, await this.loadVisible(auth, id));
  }

  /**
   * Plant sharing a Plant Number or Serial Number (PLT-004). A warning only:
   * matches outside the user's sites are counted but not shown.
   */
  async duplicates(
    auth: CustomerAuth,
    input: { plantNumber?: string; serialNumber?: string; excludeId?: string },
  ): Promise<PlantDuplicates> {
    const result: PlantDuplicates = {
      plantNumber: [],
      serialNumber: [],
      outsideScope: 0,
    };
    const hidden = new Set<string>();
    for (const [key, column] of [
      ['plantNumber', 'plant_number'],
      ['serialNumber', 'serial_number'],
    ] as const) {
      const value = input[key]?.trim();
      if (!value) continue;
      const params = new SqlParams();
      const rows = (await this.db.query(
        `${PLANT_SELECT}
          where lower(p.${column}) = lower(${params.add(value)})
            and p.id <> coalesce(${params.add(input.excludeId ?? null)}::uuid, '00000000-0000-0000-0000-000000000000')
          order by lower(p.asset_id)
          limit 50`,
        params.values,
      )) as PlantRow[];
      for (const row of rows) {
        if (this.inScope(auth, row.siteId)) result[key].push(toSummary(row));
        else hidden.add(row.id);
      }
    }
    result.outsideScope = hidden.size;
    return result;
  }

  async history(
    auth: CustomerAuth,
    id: string,
    query: HistoryQuery,
  ): Promise<Paginated<AuditEvent>> {
    await this.loadVisible(auth, id);
    return listAuditEvents(this.db, query, auth.org.timeZone, {
      type: 'plant',
      id,
    });
  }

  /**
   * The plant a QR code names, if the signed-in user may see it (PLT-AC-04).
   * Anything else — another organisation's code, plant outside the user's
   * sites, a made-up token — is answered the same: not found.
   */
  async resolveQr(auth: CustomerAuth, token: string): Promise<{ id: string }> {
    const [match] = (await this.db.query(
      'select plant_id as "plantId", org_id as "orgId" from corecheck.plant_by_qr_token($1)',
      [token],
    )) as Array<{ plantId: string; orgId: string }>;
    if (!match || match.orgId !== auth.orgId) throw notFound('Plant');
    const plant = await this.db.findOneBy(PlantEntity, { id: match.plantId });
    if (!plant || !this.inScope(auth, plant.siteId)) throw notFound('Plant');
    return { id: plant.id };
  }

  // ----------------------------------------------------------------- write

  async create(auth: CustomerAuth, input: CreateInput): Promise<PlantSaved> {
    if (!auth.permissions.has('plant.create')) throw forbidden();
    await this.checkSite(auth, input.siteId, null);
    await this.checkReferences(input, null);
    await this.checkArea(input.areaId ?? null, input.siteId, null);
    const customValues = await this.checkCustomValues(input.customValues, {});

    const assetId = input.assetId
      ? await this.checkAssetId(auth, input.assetId, null)
      : await this.nextAssetId();
    const now = this.clock.now();
    const result = await this.db.insert(PlantEntity, {
      orgId: this.tenantDb.orgId,
      assetId,
      plantNumber: blankToNull(input.plantNumber) ?? null,
      serialNumber: blankToNull(input.serialNumber) ?? null,
      name: input.name,
      plantTypeId: input.plantTypeId,
      categoryId: input.categoryId ?? null,
      make: blankToNull(input.make) ?? null,
      model: blankToNull(input.model) ?? null,
      ownership: input.ownership,
      companyId: input.companyId,
      siteId: input.siteId,
      areaId: input.areaId ?? null,
      customValues,
      status: 'pending_reception',
      statusChangedAt: now,
      statusChangedBy: auth.userId,
      qrToken: randomBytes(16).toString('base64url'),
      createdBy: auth.userId,
    });
    const id = (result.identifiers[0] as { id: string }).id;
    await this.setDisciplines(id, input.disciplineIds, []);
    await this.record(
      auth,
      'plant.created',
      id,
      `Registered ${assetId} ${input.name}`,
    );
    return this.saved(auth, id);
  }

  async update(
    auth: CustomerAuth,
    id: string,
    input: UpdateInput,
  ): Promise<PlantSaved> {
    const plant = await this.loadVisible(auth, id);
    this.ensureNotArchived(plant);
    const can = this.capabilities(auth, plant);
    if (!can.edit) {
      throw forbidden(
        plant.status === 'pending_reception'
          ? 'Only the person who registered this plant, or someone allowed to edit plant, can change it.'
          : 'This plant has been submitted. Its details can be changed only by someone allowed to edit plant.',
      );
    }

    const changingIdentifiers =
      (input.assetId !== undefined &&
        input.assetId.toLowerCase() !== plant.assetId.toLowerCase()) ||
      (input.siteId !== undefined && input.siteId !== plant.siteId);
    if (changingIdentifiers && !can.editIdentifiers) {
      throw forbidden(
        'Changing the System Asset ID or moving plant to another site needs the "Manage identifiers" permission.',
      );
    }

    const siteId = input.siteId ?? plant.siteId;
    if (siteId !== plant.siteId) await this.checkSite(auth, siteId, null);
    await this.checkReferences(
      {
        plantTypeId: input.plantTypeId ?? plant.plantTypeId,
        categoryId:
          input.categoryId === undefined ? plant.categoryId : input.categoryId,
        ownership: input.ownership ?? plant.ownership,
        companyId: input.companyId ?? plant.companyId,
        disciplineIds: input.disciplineIds,
      },
      plant,
    );
    // Moving site drops an area that belongs to the old one.
    let areaId =
      input.areaId === undefined ? plant.areaId : (input.areaId ?? null);
    if (input.areaId === undefined && siteId !== plant.siteId) areaId = null;
    await this.checkArea(areaId, siteId, plant.areaId);

    const changes: Partial<PlantEntity> = {
      assetId:
        input.assetId !== undefined &&
        input.assetId.toLowerCase() !== plant.assetId.toLowerCase()
          ? await this.checkAssetId(auth, input.assetId, plant.id)
          : input.assetId,
      plantNumber: blankToNull(input.plantNumber),
      serialNumber: blankToNull(input.serialNumber),
      name: input.name,
      plantTypeId: input.plantTypeId,
      categoryId: input.categoryId,
      make: blankToNull(input.make),
      model: blankToNull(input.model),
      ownership: input.ownership,
      companyId: input.companyId,
      siteId: input.siteId,
      areaId,
      customValues:
        input.customValues === undefined
          ? undefined
          : await this.checkCustomValues(
              input.customValues,
              plant.customValues,
            ),
    };

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) continue;
      const current = (plant as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(current ?? null) !== JSON.stringify(value)) {
        before[key] = current ?? null;
        after[key] = value;
      }
    }
    const disciplinesChanged =
      input.disciplineIds !== undefined &&
      (await this.setDisciplines(
        plant.id,
        input.disciplineIds,
        await this.disciplineIds(plant.id),
      ));

    if (Object.keys(after).length > 0) {
      await this.db.update(PlantEntity, { id: plant.id }, after);
    }
    if (Object.keys(after).length > 0 || disciplinesChanged) {
      await this.record(
        auth,
        'plant.updated',
        plant.id,
        `Updated ${String(after.assetId ?? plant.assetId)} ${String(after.name ?? plant.name)}`,
        before,
        { ...after, ...(disciplinesChanged && { disciplinesChanged: true }) },
      );
    }
    // A new type can bring mandatory documents the plant does not hold.
    if (after.plantTypeId)
      await this.compliance.enforce(userActor(auth), [plant.id]);
    return this.saved(auth, plant.id);
  }

  /**
   * Takes plant out of use (PLC-005) with a reason, and optionally records
   * why as Quarantined, Not in Use or Off-hired (PLC-002). Restricting plant
   * that is already restricted updates the reason.
   */
  async restrict(
    auth: CustomerAuth,
    id: string,
    input: RestrictInput,
  ): Promise<PlantDetail> {
    if (!auth.permissions.has('plant_status.restrict')) throw forbidden();
    const plant = await this.loadVisible(auth, id);
    this.ensureNotArchived(plant);
    await this.changeStatus(auth, plant, {
      status: 'restricted',
      restrictionReason: input.reason ?? null,
      note: input.note,
      action: 'plant.restricted',
      summary: `Restricted ${plant.assetId} ${plant.name}`,
    });
    return this.get(auth, id);
  }

  /**
   * Lifts a restriction (PLC-005). Plant that was approved before goes back
   * Online; plant never approved returns to Pending Reception so it still
   * goes through reception.
   *
   * Going Online needs every mandatory document valid (DOC-AC-01). An
   * authorised override lets plant back in use without them until a review
   * date; the missing documents are kept in the audit record (DOC-008).
   */
  async returnToService(
    auth: CustomerAuth,
    id: string,
    input: ReturnInput,
  ): Promise<PlantDetail> {
    if (!auth.permissions.has('plant_status.return_to_service'))
      throw forbidden();
    if (input.override && !auth.permissions.has('plant_status.override'))
      throw forbidden(
        'Overriding a restriction needs the override permission.',
      );
    const plant = await this.loadVisible(auth, id);
    this.ensureNotArchived(plant);
    if (plant.status !== 'restricted')
      throw conflict(ERROR_CODES.CONFLICT, 'This plant is not restricted.');

    const status = plant.approvedAt ? 'approved' : 'pending_reception';
    const blockers =
      status === 'approved' ? await this.compliance.blockers(plant.id) : [];
    const overriding = blockers.length > 0 && input.override;
    if (blockers.length > 0 && !overriding) {
      throw conflict(
        ERROR_CODES.DOCUMENTS_NOT_VALID,
        `Mandatory documents are not valid: ${blockers.join(', ')}.`,
        { documents: blockers },
      );
    }
    if (overriding) {
      const today = await this.compliance.today();
      if (!input.reviewOn || input.reviewOn < today)
        throw fieldError('reviewOn', 'Choose a review date from today on.');
      await this.db.update(
        PlantEntity,
        { id },
        {
          complianceOverrideUntil: input.reviewOn,
          complianceOverrideNote: input.note!,
          complianceOverrideBy: auth.userId,
        },
      );
    }

    await this.changeStatus(auth, plant, {
      status,
      restrictionReason: null,
      note: input.note ?? null,
      action: 'plant.returned_to_service',
      summary: `${status === 'approved' ? 'Returned to service' : 'Lifted the restriction on'} ${plant.assetId} ${plant.name}${overriding ? ' (override)' : ''}`,
      metadata: overriding
        ? { override: true, reviewOn: input.reviewOn, documents: blockers }
        : undefined,
    });
    return this.get(auth, id);
  }

  async setArchived(
    auth: CustomerAuth,
    id: string,
    archived: boolean,
  ): Promise<PlantDetail> {
    if (!auth.permissions.has('plant.archive')) throw forbidden();
    const plant = await this.loadVisible(auth, id);
    if ((plant.archivedAt !== null) !== archived) {
      await this.db.update(
        PlantEntity,
        { id },
        { archivedAt: archived ? this.clock.now() : null },
      );
      await this.record(
        auth,
        archived ? 'plant.archived' : 'plant.restored',
        id,
        `${archived ? 'Archived' : 'Restored'} ${plant.assetId} ${plant.name}`,
      );
    }
    return this.get(auth, id);
  }

  async recordExport(
    auth: CustomerAuth,
    format: string,
    count: number,
  ): Promise<void> {
    await this.audit.record(this.db, {
      scope: 'tenant',
      orgId: auth.orgId,
      actor: userActor(auth),
      action: 'plant.exported',
      entityType: 'plant_register',
      summary: `Exported ${count} plant records (${format.toUpperCase()})`,
      metadata: { format, count },
    });
  }

  // ---------------------------------------------------------------- shared

  /** A plant at one of the user's sites, or not found (ROL-AC-02). */
  async loadVisible(auth: CustomerAuth, id: string): Promise<PlantEntity> {
    const plant = await this.db.findOneBy(PlantEntity, { id });
    if (!plant || !this.inScope(auth, plant.siteId)) throw notFound('Plant');
    return plant;
  }

  inScope(auth: CustomerAuth, siteId: string): boolean {
    return auth.orgWideScope || auth.siteIds.includes(siteId);
  }

  private scopeCondition(auth: CustomerAuth, params: SqlParams): string {
    return auth.orgWideScope
      ? 'true'
      : `p.site_id = any(${params.add([...auth.siteIds])}::uuid[])`;
  }

  private filterConditions(
    auth: CustomerAuth,
    query: ListFilters,
    params: SqlParams,
  ): string {
    const where = [this.scopeCondition(auth, params)];
    if (query.status === 'archived') {
      where.push('p.archived_at is not null');
    } else {
      where.push('p.archived_at is null');
      if (query.status) where.push(`p.status = ${params.add(query.status)}`);
    }
    if (query.search) {
      const term = params.add(`%${escapeLike(query.search)}%`);
      where.push(
        `(p.asset_id ilike ${term} or p.plant_number ilike ${term}
          or p.serial_number ilike ${term} or p.name ilike ${term}
          or p.make ilike ${term} or p.model ilike ${term})`,
      );
    }
    if (query.siteId) where.push(`p.site_id = ${params.add(query.siteId)}`);
    if (query.plantTypeId)
      where.push(`p.plant_type_id = ${params.add(query.plantTypeId)}`);
    if (query.categoryId)
      where.push(`p.category_id = ${params.add(query.categoryId)}`);
    if (query.companyId)
      where.push(`p.company_id = ${params.add(query.companyId)}`);
    if (query.ownership)
      where.push(`p.ownership = ${params.add(query.ownership)}`);
    if (query.compliance)
      where.push(`(${COMPLIANCE_SQL}) = ${params.add(query.compliance)}`);
    return where.join(' and ');
  }

  private capabilities(
    auth: CustomerAuth,
    plant: PlantEntity,
  ): PlantDetail['capabilities'] {
    const has = (code: Parameters<typeof auth.permissions.has>[0]) =>
      auth.permissions.has(code);
    const active = plant.archivedAt === null;
    // PLC-003/004: the registering Operative keeps their own draft.
    const ownDraft =
      plant.status === 'pending_reception' &&
      plant.createdBy === auth.userId &&
      has('plant.create');
    return {
      edit: active && (has('plant.edit') || ownDraft),
      editIdentifiers: active && (has('plant.manage_identifiers') || ownDraft),
      archive: has('plant.archive'),
      restrict: active && has('plant_status.restrict'),
      returnToService:
        active &&
        plant.status === 'restricted' &&
        has('plant_status.return_to_service'),
      printQr: has('plant.qr'),
    };
  }

  private ensureNotArchived(plant: PlantEntity): void {
    if (plant.archivedAt)
      throw conflict(
        ERROR_CODES.CONFLICT,
        'This plant is archived. Restore it before changing it.',
      );
  }

  private async changeStatus(
    auth: CustomerAuth,
    plant: PlantEntity,
    change: {
      status: PlantEntity['status'];
      restrictionReason: PlantEntity['restrictionReason'];
      note: string | null;
      action: AuditAction;
      summary: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.db.update(
      PlantEntity,
      { id: plant.id },
      {
        status: change.status,
        restrictionReason: change.restrictionReason,
        statusNote: change.note,
        statusChangedAt: this.clock.now(),
        statusChangedBy: auth.userId,
      },
    );
    await this.record(
      auth,
      change.action,
      plant.id,
      change.summary,
      { status: plant.status, restrictionReason: plant.restrictionReason },
      {
        status: change.status,
        restrictionReason: change.restrictionReason,
        ...(change.note && { note: change.note }),
      },
      change.metadata,
    );
  }

  /** The site must be one of the user's and still in use. */
  private async checkSite(
    auth: CustomerAuth,
    siteId: string,
    current: string | null,
  ): Promise<void> {
    if (!this.inScope(auth, siteId))
      throw outOfScope('You can only register plant at your own sites.');
    const site = await this.db.findOneBy(SiteEntity, { id: siteId });
    if (!site) throw fieldError('siteId', 'Site not found.');
    if (site.archivedAt && siteId !== current)
      throw fieldError('siteId', `${site.name} is archived.`);
  }

  private async checkArea(
    areaId: string | null,
    siteId: string,
    current: string | null,
  ): Promise<void> {
    if (!areaId) return;
    const area = await this.db.findOneBy(AreaEntity, { id: areaId });
    if (!area || area.siteId !== siteId)
      throw fieldError('areaId', 'Choose an area on the plant’s site.');
    if (area.archivedAt && areaId !== current)
      throw fieldError('areaId', `${area.name} is archived.`);
  }

  /**
   * Type, category, company and disciplines exist and, unless the plant
   * already uses them, are not archived. The company must match the
   * ownership: an owner for owned plant, a hire company for hired (PLT-006).
   */
  private async checkReferences(
    input: {
      plantTypeId: string;
      categoryId?: string | null;
      ownership: PlantEntity['ownership'];
      companyId: string;
      disciplineIds?: string[];
    },
    plant: PlantEntity | null,
  ): Promise<void> {
    const type = await this.db.findOneBy(PlantTypeEntity, {
      id: input.plantTypeId,
    });
    if (!type) throw fieldError('plantTypeId', 'Plant type not found.');
    if (type.archivedAt && type.id !== plant?.plantTypeId)
      throw fieldError('plantTypeId', `${type.name} is archived.`);

    if (input.categoryId) {
      const category = await this.db.findOneBy(PlantCategoryEntity, {
        id: input.categoryId,
      });
      if (!category) throw fieldError('categoryId', 'Category not found.');
      if (category.archivedAt && category.id !== plant?.categoryId)
        throw fieldError('categoryId', `${category.name} is archived.`);
    }

    const company = await this.db.findOneBy(PlantCompanyEntity, {
      id: input.companyId,
    });
    if (!company) throw fieldError('companyId', 'Company not found.');
    if (company.archivedAt && company.id !== plant?.companyId)
      throw fieldError('companyId', `${company.name} is archived.`);
    if (company.kind !== OWNERSHIP_COMPANY_KIND[input.ownership])
      throw fieldError(
        'companyId',
        input.ownership === 'owned'
          ? 'Owned plant needs an owner, not a hire company.'
          : 'Hired plant needs a hire company, not an owner.',
      );

    if (input.disciplineIds?.length) {
      const current = plant ? await this.disciplineIds(plant.id) : [];
      const disciplines = await this.db.findBy(DisciplineEntity, {});
      const byId = new Map(disciplines.map((item) => [item.id, item]));
      for (const disciplineId of input.disciplineIds) {
        const discipline = byId.get(disciplineId);
        if (!discipline)
          throw fieldError('disciplineIds', 'Discipline not found.');
        if (discipline.archivedAt && !current.includes(disciplineId))
          throw fieldError('disciplineIds', `${discipline.name} is archived.`);
      }
    }
  }

  /**
   * Checks custom values against the fields an Admin configured (PLT-008):
   * known fields only, the right type, choices from the list, and required
   * fields filled. Values of archived fields are kept as they were.
   */
  private async checkCustomValues(
    input: Record<string, CustomValue>,
    current: Record<string, CustomValue>,
  ): Promise<Record<string, CustomValue>> {
    const fields = await this.db.find(PlantCustomFieldEntity);
    const byId = new Map(fields.map((field) => [field.id, field]));
    const result: Record<string, CustomValue> = {};

    for (const field of fields) {
      if (field.archivedAt && current[field.id] !== undefined)
        result[field.id] = current[field.id]!;
    }
    for (const [fieldId, raw] of Object.entries(input)) {
      const field = byId.get(fieldId);
      const path = `customValues.${fieldId}`;
      if (!field) throw fieldError(path, 'Unknown custom field.');
      if (field.archivedAt) continue;
      if (raw === '') continue;
      switch (field.fieldType) {
        case 'number':
          if (typeof raw !== 'number')
            throw fieldError(path, `${field.label} must be a number.`);
          break;
        case 'date':
          if (
            typeof raw !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
            Number.isNaN(Date.parse(raw))
          )
            throw fieldError(path, `${field.label} must be a date.`);
          break;
        case 'select':
          if (typeof raw !== 'string' || !field.options.includes(raw))
            throw fieldError(path, `Choose one of the ${field.label} options.`);
          break;
        default:
          if (typeof raw !== 'string')
            throw fieldError(path, `${field.label} must be text.`);
      }
      result[fieldId] = raw;
    }
    for (const field of fields) {
      if (field.required && !field.archivedAt && result[field.id] === undefined)
        throw fieldError(
          `customValues.${field.id}`,
          `${field.label} is required.`,
        );
    }
    return result;
  }

  /** A supplied System Asset ID, refused if another plant has it (PLT-003). */
  private async checkAssetId(
    auth: CustomerAuth,
    assetId: string,
    exceptId: string | null,
  ): Promise<string> {
    const [existing] = (await this.db.query(
      `select id, site_id as "siteId" from corecheck.plants
        where lower(asset_id) = lower($1) and id <> coalesce($2::uuid, '00000000-0000-0000-0000-000000000000')`,
      [assetId, exceptId],
    )) as Array<{ id: string; siteId: string }>;
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ERROR_CODES.CONFLICT,
        'A plant with this System Asset ID already exists.',
        {
          fieldErrors: [
            {
              field: 'assetId',
              message: 'A plant with this System Asset ID already exists.',
            },
          ],
          // Link to it only when the user may open it.
          details: this.inScope(auth, existing.siteId)
            ? { plantId: existing.id }
            : undefined,
        },
      );
    }
    return assetId;
  }

  /**
   * The next free generated System Asset ID. The counter row serialises
   * concurrent registrations; a number already taken by a hand-entered ID
   * is skipped.
   */
  private async nextAssetId(): Promise<string> {
    for (;;) {
      const [{ value }] = (await this.db.query(
        `insert into corecheck.plant_asset_counters as c (org_id, next_value)
         values ($1, 2)
         on conflict (org_id) do update set next_value = c.next_value + 1
         returning c.next_value - 1 as value`,
        [this.tenantDb.orgId],
      )) as [{ value: number }];
      const candidate = formatAssetId(value);
      const [taken] = (await this.db.query(
        'select 1 from corecheck.plants where lower(asset_id) = lower($1)',
        [candidate],
      )) as unknown[];
      if (!taken) return candidate;
    }
  }

  private async disciplineIds(plantId: string): Promise<string[]> {
    return (await this.db.findBy(PlantDisciplineEntity, { plantId })).map(
      (row) => row.disciplineId,
    );
  }

  /** Replaces the plant's disciplines; true when anything changed. */
  private async setDisciplines(
    plantId: string,
    next: string[],
    current: string[],
  ): Promise<boolean> {
    const added = next.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !next.includes(id));
    for (const disciplineId of removed)
      await this.db.delete(PlantDisciplineEntity, { plantId, disciplineId });
    if (added.length)
      await this.db.insert(
        PlantDisciplineEntity,
        added.map((disciplineId) => ({
          orgId: this.tenantDb.orgId,
          plantId,
          disciplineId,
        })),
      );
    return added.length > 0 || removed.length > 0;
  }

  private async saved(auth: CustomerAuth, id: string): Promise<PlantSaved> {
    const plant = await this.get(auth, id);
    return {
      plant,
      duplicates: await this.duplicates(auth, {
        plantNumber: plant.plantNumber ?? undefined,
        serialNumber: plant.serialNumber ?? undefined,
        excludeId: id,
      }),
    };
  }

  private async detail(
    auth: CustomerAuth,
    plant: PlantEntity,
  ): Promise<PlantDetail> {
    const [row] = (await this.db.query(`${PLANT_SELECT} where p.id = $1`, [
      plant.id,
    ])) as PlantRow[];
    const disciplines = (await this.db.query(
      `select d.id, d.name from corecheck.plant_disciplines pd
         join corecheck.disciplines d on d.id = pd.discipline_id
        where pd.plant_id = $1 order by lower(d.name)`,
      [plant.id],
    )) as IdName[];
    const people = await this.db.findBy(UserEntity, [
      { id: plant.createdBy },
      ...(plant.statusChangedBy ? [{ id: plant.statusChangedBy }] : []),
    ]);
    const nameOf = (userId: string | null) => {
      const user = people.find((person) => person.id === userId);
      return user ? fullName(user) : null;
    };
    const overrideActive =
      !!plant.complianceOverrideUntil &&
      plant.complianceOverrideUntil >= (await this.compliance.today());
    return {
      ...toSummary(row!),
      disciplines,
      customValues: plant.customValues,
      statusNote: plant.statusNote,
      statusChangedAt: plant.statusChangedAt.toISOString(),
      statusChangedBy: nameOf(plant.statusChangedBy),
      approvedAt: plant.approvedAt?.toISOString() ?? null,
      complianceOverride: overrideActive
        ? {
            until: plant.complianceOverrideUntil!,
            note: plant.complianceOverrideNote ?? '',
          }
        : null,
      createdAt: plant.createdAt.toISOString(),
      createdBy: nameOf(plant.createdBy) ?? 'Unknown',
      capabilities: this.capabilities(auth, plant),
    };
  }

  private record(
    auth: CustomerAuth,
    action: AuditAction,
    entityId: string,
    summary: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(this.db, {
      scope: 'tenant',
      orgId: auth.orgId,
      actor: userActor(auth),
      action,
      entityType: 'plant',
      entityId,
      summary,
      before,
      after,
      metadata,
    });
  }
}
