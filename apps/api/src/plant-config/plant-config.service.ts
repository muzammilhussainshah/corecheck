import { Injectable } from '@nestjs/common';
import type {
  EntityManager,
  ObjectLiteral,
  QueryDeepPartialEntity,
} from 'typeorm';
import { z } from 'zod';
import {
  type AuditAction,
  createCustomFieldSchema,
  createDocumentTypeSchema,
  createMeterTypeSchema,
  createPlantCategorySchema,
  createPlantCompanySchema,
  createPlantTypeSchema,
  type CustomField,
  type DocumentType,
  type MeterType,
  type PermissionCode,
  type PlantCategory,
  type PlantCompany,
  type PlantType,
  updateCustomFieldSchema,
  updateDocumentTypeSchema,
  updateMeterTypeSchema,
  updatePlantCategorySchema,
  updatePlantCompanySchema,
  updatePlantTypeSchema,
} from '@corecheck/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import type { CustomerAuth } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import { fieldError, forbidden, notFound } from '../common/errors.js';
import { parseWith } from '../common/validation.js';
import {
  PlantCustomFieldEntity,
  DocumentTypeEntity,
  MeterTypeEntity,
  PlantCategoryEntity,
  PlantCompanyEntity,
  PlantTypeEntity,
  PlantTypeRequiredDocumentEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';

/** Blank optional text is stored as null rather than an empty string. */
const blankToNull = (value: unknown): unknown => (value === '' ? null : value);

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

interface ConfigRow {
  id: string;
  orgId: string;
  archivedAt: Date | null;
}

/**
 * One configuration list. The service handles every list the same way —
 * list, create, edit, archive and restore, each audited — and this record
 * says what differs: the table, who may view and change it, how input is
 * validated and how a row is shown.
 */
interface ConfigKind<Row extends ConfigRow, Dto> {
  entity: new () => Row;
  /** "Plant type": used in messages. */
  label: string;
  /** Audit action prefix and entity type, e.g. "plant_type". */
  auditKey: string;
  view: PermissionCode;
  manage: PermissionCode;
  createSchema: z.ZodType;
  updateSchema: z.ZodType;
  /** The row's name in audit summaries. */
  nameOf: (row: Row) => string;
  /** Turns validated input into column values. */
  toColumns: (input: Record<string, unknown>) => Record<string, unknown>;
  toDto: (row: Row, extras: KindExtras) => Dto;
  order: Record<string, 'ASC' | 'DESC'>;
  /** Extra rule checked against the stored row before an update. */
  checkUpdate?: (row: Row, input: Record<string, unknown>) => void;
}

/** Data some lists add to their rows, loaded once per request. */
interface KindExtras {
  requiredDocuments: Map<string, string[]>;
}

const textColumns = (input: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, blankToNull(value)]),
  );

const plantType: ConfigKind<PlantTypeEntity, PlantType> = {
  entity: PlantTypeEntity,
  label: 'Plant type',
  auditKey: 'plant_type',
  view: 'plant.view',
  manage: 'plant_config.manage',
  createSchema: createPlantTypeSchema,
  updateSchema: updatePlantTypeSchema,
  nameOf: (row) => row.name,
  toColumns: textColumns,
  toDto: (row, extras) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    archivedAt: iso(row.archivedAt),
    requiredDocumentTypeIds: extras.requiredDocuments.get(row.id) ?? [],
  }),
  order: { name: 'ASC' },
};

const plantCategory: ConfigKind<PlantCategoryEntity, PlantCategory> = {
  entity: PlantCategoryEntity,
  label: 'Category',
  auditKey: 'plant_category',
  view: 'plant.view',
  manage: 'plant_config.manage',
  createSchema: createPlantCategorySchema,
  updateSchema: updatePlantCategorySchema,
  nameOf: (row) => row.name,
  toColumns: textColumns,
  toDto: (row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    archivedAt: iso(row.archivedAt),
  }),
  order: { name: 'ASC' },
};

const plantCompany: ConfigKind<PlantCompanyEntity, PlantCompany> = {
  entity: PlantCompanyEntity,
  label: 'Company',
  auditKey: 'plant_company',
  view: 'plant.view',
  manage: 'plant_config.manage',
  createSchema: createPlantCompanySchema,
  updateSchema: updatePlantCompanySchema,
  nameOf: (row) => row.name,
  toColumns: textColumns,
  toDto: (row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    archivedAt: iso(row.archivedAt),
  }),
  order: { kind: 'ASC', name: 'ASC' },
};

const customField: ConfigKind<PlantCustomFieldEntity, CustomField> = {
  entity: PlantCustomFieldEntity,
  label: 'Custom field',
  auditKey: 'custom_field',
  view: 'plant.view',
  manage: 'plant_config.manage',
  createSchema: createCustomFieldSchema,
  updateSchema: updateCustomFieldSchema,
  nameOf: (row) => row.label,
  toColumns: (input) => input,
  toDto: (row) => ({
    id: row.id,
    label: row.label,
    fieldType: row.fieldType,
    options: row.options,
    required: row.required,
    sortOrder: row.sortOrder,
    archivedAt: iso(row.archivedAt),
  }),
  order: { sortOrder: 'ASC', label: 'ASC' },
  checkUpdate: (row, input) => {
    const options = input.options as string[] | undefined;
    if (row.fieldType === 'select' && options && options.length === 0)
      throw fieldError('options', 'Add at least one choice.');
    if (row.fieldType !== 'select' && options && options.length > 0)
      throw fieldError('options', 'Only a choice-list field has choices.');
  },
};

const meterType: ConfigKind<MeterTypeEntity, MeterType> = {
  entity: MeterTypeEntity,
  label: 'Meter type',
  auditKey: 'meter_type',
  // Anyone who records readings needs to see the meter types.
  view: 'meters.record',
  manage: 'meters.configure',
  createSchema: createMeterTypeSchema,
  updateSchema: updateMeterTypeSchema,
  nameOf: (row) => row.name,
  toColumns: (input) => input,
  toDto: (row) => ({
    id: row.id,
    name: row.name,
    unit: row.unit,
    archivedAt: iso(row.archivedAt),
  }),
  order: { name: 'ASC' },
};

const documentType: ConfigKind<DocumentTypeEntity, DocumentType> = {
  entity: DocumentTypeEntity,
  label: 'Document type',
  auditKey: 'document_type',
  view: 'documents.view',
  manage: 'documents.configure',
  createSchema: createDocumentTypeSchema,
  updateSchema: updateDocumentTypeSchema,
  nameOf: (row) => row.name,
  toColumns: textColumns,
  toDto: (row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    hasExpiry: row.hasExpiry,
    warningDays: row.warningDays,
    archivedAt: iso(row.archivedAt),
  }),
  order: { name: 'ASC' },
};

/** The lists, keyed by the URL segment they live under (/config/<kind>). */
export const CONFIG_KINDS = {
  'plant-types': plantType,
  'plant-categories': plantCategory,
  'plant-companies': plantCompany,
  'custom-fields': customField,
  'meter-types': meterType,
  'document-types': documentType,
} as const;

export type ConfigKindKey = keyof typeof CONFIG_KINDS;

type AnyKind = ConfigKind<ConfigRow & ObjectLiteral, unknown>;
/** Column values for an insert or update; each list validated them already. */
type Columns = QueryDeepPartialEntity<ConfigRow & ObjectLiteral>;

export const isConfigKind = (value: string): value is ConfigKindKey =>
  Object.hasOwn(CONFIG_KINDS, value);

/**
 * Plant configuration an Admin maintains (FRD ADM-003): plant types,
 * categories, owners and hire companies, custom fields (PLT-008), meter
 * types (MTR-001) and document types (DOC-001). Archiving keeps every record
 * that already uses an item but stops it being chosen for new ones.
 */
@Injectable()
export class PlantConfigService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  private kind(key: ConfigKindKey): AnyKind {
    return CONFIG_KINDS[key] as unknown as AnyKind;
  }

  private require(auth: CustomerAuth, permission: PermissionCode): void {
    if (!auth.permissions.has(permission)) throw forbidden();
  }

  async list(
    auth: CustomerAuth,
    key: ConfigKindKey,
    includeArchived: boolean,
  ): Promise<unknown[]> {
    const kind = this.kind(key);
    // Whoever may change a list may also read it, archived items included.
    if (!auth.permissions.has(kind.view)) this.require(auth, kind.manage);
    const rows = await this.db.find(kind.entity, { order: kind.order });
    const extras = await this.extras(key);
    return rows
      .filter((row) => includeArchived || row.archivedAt === null)
      .map((row) => kind.toDto(row, extras));
  }

  async create(
    auth: CustomerAuth,
    key: ConfigKindKey,
    body: unknown,
  ): Promise<unknown> {
    const kind = this.kind(key);
    this.require(auth, kind.manage);
    const input = parseWith(kind.createSchema, body) as Record<string, unknown>;
    const result = await this.db.insert(kind.entity, {
      orgId: this.tenantDb.orgId,
      ...kind.toColumns(input),
    } as Columns);
    const id = (result.identifiers[0] as { id: string }).id;
    const row = await this.load(kind, id);
    await this.record(
      auth,
      kind,
      'created',
      id,
      `Created ${kind.label.toLowerCase()} ${kind.nameOf(row)}`,
    );
    return this.dto(key, row);
  }

  async update(
    auth: CustomerAuth,
    key: ConfigKindKey,
    id: string,
    body: unknown,
  ): Promise<unknown> {
    const kind = this.kind(key);
    this.require(auth, kind.manage);
    const input = parseWith(kind.updateSchema, body) as Record<string, unknown>;
    const row = await this.load(kind, id);
    kind.checkUpdate?.(row, input);

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(kind.toColumns(input))) {
      if (value === undefined) continue;
      const current = (row as unknown as Record<string, unknown>)[column];
      if (JSON.stringify(current) !== JSON.stringify(value)) {
        before[column] = current;
        after[column] = value;
      }
    }
    if (Object.keys(after).length > 0) {
      await this.db.update(kind.entity, { id }, after as Columns);
      const updated = await this.load(kind, id);
      await this.record(
        auth,
        kind,
        'updated',
        id,
        `Updated ${kind.label.toLowerCase()} ${kind.nameOf(updated)}`,
        before,
        after,
      );
      return this.dto(key, updated);
    }
    return this.dto(key, row);
  }

  async setArchived(
    auth: CustomerAuth,
    key: ConfigKindKey,
    id: string,
    archived: boolean,
  ): Promise<unknown> {
    const kind = this.kind(key);
    this.require(auth, kind.manage);
    const row = await this.load(kind, id);
    if ((row.archivedAt !== null) !== archived) {
      await this.db.update(kind.entity, { id }, {
        archivedAt: archived ? this.clock.now() : null,
      } as Columns);
      await this.record(
        auth,
        kind,
        archived ? 'archived' : 'restored',
        id,
        `${archived ? 'Archived' : 'Restored'} ${kind.label.toLowerCase()} ${kind.nameOf(row)}`,
      );
    }
    return this.dto(key, await this.load(kind, id));
  }

  /**
   * Replaces the documents a plant type must hold (DOC-001). Archived
   * document types already required stay allowed; new ones must be active.
   */
  async setRequiredDocuments(
    auth: CustomerAuth,
    plantTypeId: string,
    documentTypeIds: string[],
  ): Promise<PlantType> {
    this.require(auth, 'documents.configure');
    const type = (await this.load(
      this.kind('plant-types'),
      plantTypeId,
    )) as PlantTypeEntity;
    const current = (
      await this.db.find(PlantTypeRequiredDocumentEntity, {
        where: { plantTypeId },
      })
    ).map((row) => row.documentTypeId);

    const added = documentTypeIds.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !documentTypeIds.includes(id));
    if (added.length === 0 && removed.length === 0)
      return (await this.dto('plant-types', type)) as PlantType;

    const documentTypes = await this.db.find(DocumentTypeEntity);
    const byId = new Map(documentTypes.map((doc) => [doc.id, doc]));
    for (const id of added) {
      const doc = byId.get(id);
      if (!doc) throw fieldError('documentTypeIds', 'Document type not found.');
      if (doc.archivedAt)
        throw fieldError(
          'documentTypeIds',
          `${doc.name} is archived and cannot be made mandatory.`,
        );
    }

    for (const documentTypeId of removed)
      await this.db.delete(PlantTypeRequiredDocumentEntity, {
        plantTypeId,
        documentTypeId,
      });
    if (added.length > 0)
      await this.db.insert(
        PlantTypeRequiredDocumentEntity,
        added.map((documentTypeId) => ({
          orgId: this.tenantDb.orgId,
          plantTypeId,
          documentTypeId,
        })),
      );

    const names = (ids: string[]) =>
      ids.map((id) => byId.get(id)?.name ?? id).sort();
    await this.audit.record(this.db, {
      scope: 'tenant',
      orgId: auth.orgId,
      actor: userActor(auth),
      action: 'plant_type.requirements_changed',
      entityType: 'plant_type',
      entityId: plantTypeId,
      summary: `Changed the mandatory documents of ${type.name}`,
      before: { documents: names(current) },
      after: { documents: names(documentTypeIds) },
    });
    return (await this.dto('plant-types', type)) as PlantType;
  }

  // ---------------------------------------------------------------- shared

  private async load(kind: AnyKind, id: string): Promise<ConfigRow> {
    const row = await this.db.findOneBy(kind.entity, { id });
    if (!row) throw notFound(kind.label);
    return row;
  }

  private async dto(key: ConfigKindKey, row: ConfigRow): Promise<unknown> {
    return this.kind(key).toDto(
      row as ConfigRow & ObjectLiteral,
      await this.extras(key),
    );
  }

  private async extras(key: ConfigKindKey): Promise<KindExtras> {
    const requiredDocuments = new Map<string, string[]>();
    if (key === 'plant-types') {
      const rows = await this.db.find(PlantTypeRequiredDocumentEntity);
      for (const row of rows) {
        const list = requiredDocuments.get(row.plantTypeId) ?? [];
        list.push(row.documentTypeId);
        requiredDocuments.set(row.plantTypeId, list);
      }
    }
    return { requiredDocuments };
  }

  private record(
    auth: CustomerAuth,
    kind: AnyKind,
    verb: 'created' | 'updated' | 'archived' | 'restored',
    entityId: string,
    summary: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(this.db, {
      scope: 'tenant',
      orgId: auth.orgId,
      actor: userActor(auth),
      action: `${kind.auditKey}.${verb}` as AuditAction,
      entityType: kind.auditKey,
      entityId,
      summary,
      before,
      after,
    });
  }
}
