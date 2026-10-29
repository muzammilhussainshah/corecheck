import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import {
  type AuditAction,
  type DocumentRegisterRow,
  type DocumentVersion,
  ERROR_CODES,
  type listDocumentsQuerySchema,
  type Paginated,
  type PlantDocument,
  type PlantDocuments,
  type replaceDocumentSchema,
  type uploadDocumentSchema,
} from '@corecheck/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import { type CustomerAuth, fullName } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import { checkDocumentFile } from '../common/document-file.js';
import { conflict, fieldError, forbidden, notFound } from '../common/errors.js';
import { escapeLike, SqlParams } from '../common/sql.js';
import { StorageService } from '../common/storage.service.js';
import {
  DocumentTypeEntity,
  PlantDocumentEntity,
  PlantDocumentVersionEntity,
  type PlantEntity,
  UserEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { ComplianceService } from './compliance.service.js';
import { PlantsService } from './plants.service.js';

type UploadFields = z.output<typeof uploadDocumentSchema>;
type ReplaceFields = z.output<typeof replaceDocumentSchema>;
type RegisterQuery = z.output<typeof listDocumentsQuerySchema>;

export type UploadedFile =
  { buffer: Buffer; size: number; originalname?: string } | undefined;

const REGISTER_SORT: Record<RegisterQuery['sort'], string> = {
  expiresOn: 'v.expires_on',
  uploadedAt: 'v.uploaded_at',
  assetId: 'lower(p.asset_id)',
};

/**
 * Plant documents and certificates (FRD 9). Anyone who may upload can add
 * a document or a new version within their sites (DOC-003); Supervisors,
 * Managers and Admins verify or reject (DOC-003); replacing keeps every
 * earlier file and its verification (DOC-007). Each change rechecks the
 * plant's mandatory documents (DOC-AC-01). Document events are recorded
 * against the plant, so they show in its history.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly plants: PlantsService,
    private readonly compliance: ComplianceService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  // ------------------------------------------------------------------ read

  async forPlant(auth: CustomerAuth, plantId: string): Promise<PlantDocuments> {
    this.require(auth, 'documents.view');
    const plant = await this.plants.loadVisible(auth, plantId);
    const documents = await this.db.find(PlantDocumentEntity, {
      where: { plantId },
      order: { createdAt: 'ASC' },
    });
    return {
      compliance: await this.compliance.forPlant(plant),
      documents: await this.toDocuments(auth, documents),
      capabilities: {
        upload: auth.permissions.has('documents.upload') && !plant.archivedAt,
      },
    };
  }

  /** The Documents register: every document at the user's sites. */
  async register(
    auth: CustomerAuth,
    query: RegisterQuery,
  ): Promise<Paginated<DocumentRegisterRow>> {
    this.require(auth, 'documents.view');
    const params = new SqlParams();
    const where = ['p.archived_at is null'];
    if (!auth.orgWideScope)
      where.push(`p.site_id = any(${params.add([...auth.siteIds])}::uuid[])`);
    if (query.state) where.push(`s.state = ${params.add(query.state)}`);
    else where.push(`s.state <> 'archived'`);
    if (query.documentTypeId)
      where.push(`d.document_type_id = ${params.add(query.documentTypeId)}`);
    if (query.siteId) where.push(`p.site_id = ${params.add(query.siteId)}`);
    if (query.search) {
      const term = params.add(`%${escapeLike(query.search)}%`);
      where.push(
        `(p.asset_id ilike ${term} or p.name ilike ${term} or v.reference ilike ${term})`,
      );
    }
    const from = `
      from corecheck.plant_documents d
      join corecheck.plant_document_states s on s.document_id = d.id
      join corecheck.plant_document_versions v on v.id = d.current_version_id
      join corecheck.plants p on p.id = d.plant_id
      join corecheck.sites si on si.id = p.site_id
      join corecheck.document_types t on t.id = d.document_type_id
     where ${where.join(' and ')}`;
    const [{ total }] = (await this.db.query(
      `select count(*)::int as total ${from}`,
      params.values,
    )) as [{ total: number }];
    const rows = (await this.db.query(
      `select d.id, s.state, v.reference,
              to_char(v.expires_on, 'YYYY-MM-DD') as "expiresOn",
              v.uploaded_at as "uploadedAt",
              t.id as "typeId", t.name as "typeName",
              p.id as "plantId", p.asset_id as "assetId", p.name as "plantName",
              si.id as "siteId", si.name as "siteName"
        ${from}
        order by ${REGISTER_SORT[query.sort]} ${query.order} nulls last, d.id
        limit ${params.add(query.pageSize)} offset ${params.add((query.page - 1) * query.pageSize)}`,
      params.values,
    )) as Array<{
      id: string;
      state: DocumentRegisterRow['state'];
      reference: string | null;
      expiresOn: string | null;
      uploadedAt: Date;
      typeId: string;
      typeName: string;
      plantId: string;
      assetId: string;
      plantName: string;
      siteId: string;
      siteName: string;
    }>;
    return {
      items: rows.map((row) => ({
        id: row.id,
        plant: {
          id: row.plantId,
          assetId: row.assetId,
          name: row.plantName,
          site: { id: row.siteId, name: row.siteName },
        },
        documentType: { id: row.typeId, name: row.typeName },
        state: row.state,
        reference: row.reference,
        expiresOn: row.expiresOn,
        uploadedAt: row.uploadedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** A version's file, if the user may see the plant (DOC-AC-03). */
  async file(
    auth: CustomerAuth,
    documentId: string,
    versionId: string,
  ): Promise<{ body: Buffer; contentType: string; fileName: string }> {
    this.require(auth, 'documents.view');
    const { document } = await this.loadVisible(auth, documentId);
    const version = await this.db.findOneBy(PlantDocumentVersionEntity, {
      id: versionId,
      documentId: document.id,
    });
    if (!version) throw notFound('Document');
    return {
      body: await this.storage.get(version.storagePath),
      contentType: version.contentType,
      fileName: version.fileName,
    };
  }

  // ----------------------------------------------------------------- write

  async upload(
    auth: CustomerAuth,
    plantId: string,
    fields: UploadFields,
    upload: UploadedFile,
  ): Promise<PlantDocument> {
    this.require(auth, 'documents.upload');
    const plant = await this.plants.loadVisible(auth, plantId);
    if (plant.archivedAt)
      throw conflict(
        ERROR_CODES.CONFLICT,
        'This plant is archived. Restore it before adding documents.',
      );
    const type = await this.db.findOneBy(DocumentTypeEntity, {
      id: fields.documentTypeId,
    });
    if (!type) throw fieldError('documentTypeId', 'Document type not found.');
    if (type.archivedAt)
      throw fieldError('documentTypeId', `${type.name} is archived.`);
    this.checkExpiry(type, fields.expiresOn);
    const file = checkDocumentFile(upload);

    const inserted = await this.db.insert(PlantDocumentEntity, {
      orgId: this.tenantDb.orgId,
      plantId,
      documentTypeId: type.id,
      createdBy: auth.userId,
    });
    const documentId = (inserted.identifiers[0] as { id: string }).id;
    await this.addVersion(auth, plant, documentId, 1, fields, file);
    await this.record(
      auth,
      plant,
      'document.uploaded',
      documentId,
      `Uploaded ${type.name} for ${plant.assetId}`,
    );
    await this.compliance.enforce(userActor(auth), [plantId]);
    return this.one(auth, documentId);
  }

  /** A new version: the earlier file and its verification are kept. */
  async replace(
    auth: CustomerAuth,
    documentId: string,
    fields: ReplaceFields,
    upload: UploadedFile,
  ): Promise<PlantDocument> {
    this.require(auth, 'documents.upload');
    const { document, plant } = await this.loadVisible(auth, documentId);
    this.ensureActive(document, plant);
    const type = await this.db.findOneByOrFail(DocumentTypeEntity, {
      id: document.documentTypeId,
    });
    this.checkExpiry(type, fields.expiresOn);
    const file = checkDocumentFile(upload);
    const [{ last }] = (await this.db.query(
      `select coalesce(max(version), 0)::int as last
         from corecheck.plant_document_versions where document_id = $1`,
      [documentId],
    )) as [{ last: number }];
    await this.addVersion(auth, plant, documentId, last + 1, fields, file);
    await this.record(
      auth,
      plant,
      'document.replaced',
      documentId,
      `Replaced ${type.name} for ${plant.assetId} (version ${last + 1})`,
    );
    await this.compliance.enforce(userActor(auth), [plant.id]);
    return this.one(auth, documentId);
  }

  async verify(auth: CustomerAuth, documentId: string): Promise<PlantDocument> {
    this.require(auth, 'documents.verify');
    const { document, plant, version, type } = await this.loadCurrent(
      auth,
      documentId,
    );
    this.ensureActive(document, plant);
    if (version.verification !== 'awaiting')
      throw conflict(
        ERROR_CODES.CONFLICT,
        version.verification === 'verified'
          ? 'This document is already verified.'
          : 'A rejected document needs a new version before it can be verified.',
      );
    await this.db.update(
      PlantDocumentVersionEntity,
      { id: version.id },
      {
        verification: 'verified',
        verifiedBy: auth.userId,
        verifiedAt: this.clock.now(),
      },
    );
    await this.record(
      auth,
      plant,
      'document.verified',
      documentId,
      `Verified ${type.name} for ${plant.assetId}`,
    );
    await this.compliance.enforce(userActor(auth), [plant.id]);
    return this.one(auth, documentId);
  }

  async reject(
    auth: CustomerAuth,
    documentId: string,
    reason: string,
  ): Promise<PlantDocument> {
    this.require(auth, 'documents.verify');
    const { document, plant, version, type } = await this.loadCurrent(
      auth,
      documentId,
    );
    this.ensureActive(document, plant);
    if (version.verification === 'rejected')
      throw conflict(
        ERROR_CODES.CONFLICT,
        'This document is already rejected.',
      );
    await this.db.update(
      PlantDocumentVersionEntity,
      { id: version.id },
      {
        verification: 'rejected',
        verifiedBy: auth.userId,
        verifiedAt: this.clock.now(),
        rejectionReason: reason,
      },
    );
    await this.record(
      auth,
      plant,
      'document.rejected',
      documentId,
      `Rejected ${type.name} for ${plant.assetId}`,
      { reason },
    );
    await this.compliance.enforce(userActor(auth), [plant.id]);
    return this.one(auth, documentId);
  }

  async setArchived(
    auth: CustomerAuth,
    documentId: string,
    archived: boolean,
  ): Promise<PlantDocument> {
    this.require(auth, 'documents.manage');
    const { document, plant } = await this.loadVisible(auth, documentId);
    if ((document.archivedAt !== null) !== archived) {
      const type = await this.db.findOneByOrFail(DocumentTypeEntity, {
        id: document.documentTypeId,
      });
      await this.db.update(
        PlantDocumentEntity,
        { id: documentId },
        { archivedAt: archived ? this.clock.now() : null },
      );
      await this.record(
        auth,
        plant,
        archived ? 'document.archived' : 'document.restored',
        documentId,
        `${archived ? 'Archived' : 'Restored'} ${type.name} for ${plant.assetId}`,
      );
      await this.compliance.enforce(userActor(auth), [plant.id]);
    }
    return this.one(auth, documentId);
  }

  // ---------------------------------------------------------------- shared

  private require(
    auth: CustomerAuth,
    permission: Parameters<CustomerAuth['permissions']['has']>[0],
  ): void {
    if (!auth.permissions.has(permission)) throw forbidden();
  }

  private checkExpiry(type: DocumentTypeEntity, expiresOn?: string): void {
    if (type.hasExpiry && !expiresOn)
      throw fieldError('expiresOn', `${type.name} needs an expiry date.`);
  }

  private ensureActive(
    document: PlantDocumentEntity,
    plant: PlantEntity,
  ): void {
    if (document.archivedAt)
      throw conflict(
        ERROR_CODES.CONFLICT,
        'This document is archived. Restore it first.',
      );
    if (plant.archivedAt)
      throw conflict(ERROR_CODES.CONFLICT, 'This plant is archived.');
  }

  /** A document whose plant the user may see; otherwise not found. */
  private async loadVisible(
    auth: CustomerAuth,
    documentId: string,
  ): Promise<{ document: PlantDocumentEntity; plant: PlantEntity }> {
    const document = await this.db.findOneBy(PlantDocumentEntity, {
      id: documentId,
    });
    if (!document) throw notFound('Document');
    try {
      return {
        document,
        plant: await this.plants.loadVisible(auth, document.plantId),
      };
    } catch {
      throw notFound('Document');
    }
  }

  private async loadCurrent(auth: CustomerAuth, documentId: string) {
    const { document, plant } = await this.loadVisible(auth, documentId);
    const version = await this.db.findOneByOrFail(PlantDocumentVersionEntity, {
      id: document.currentVersionId!,
    });
    const type = await this.db.findOneByOrFail(DocumentTypeEntity, {
      id: document.documentTypeId,
    });
    return { document, plant, version, type };
  }

  private async addVersion(
    auth: CustomerAuth,
    plant: PlantEntity,
    documentId: string,
    version: number,
    fields: ReplaceFields,
    file: ReturnType<typeof checkDocumentFile>,
  ): Promise<void> {
    const result = await this.db.insert(PlantDocumentVersionEntity, {
      orgId: this.tenantDb.orgId,
      documentId,
      version,
      reference: fields.reference || null,
      issuedOn: fields.issuedOn ?? null,
      expiresOn: fields.expiresOn ?? null,
      storagePath: 'pending',
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.body.length,
      uploadedBy: auth.userId,
      verification: 'awaiting',
    });
    const versionId = (result.identifiers[0] as { id: string }).id;
    const storagePath = `${this.tenantDb.orgId}/plants/${plant.id}/documents/${documentId}/${versionId}.${file.extension}`;
    // Written before the transaction commits: a failure here rolls the
    // records back, and an orphaned file is harmless.
    await this.storage.put(storagePath, file.body, file.contentType);
    await this.db.update(
      PlantDocumentVersionEntity,
      { id: versionId },
      { storagePath },
    );
    await this.db.update(
      PlantDocumentEntity,
      { id: documentId },
      { currentVersionId: versionId },
    );
  }

  private async one(
    auth: CustomerAuth,
    documentId: string,
  ): Promise<PlantDocument> {
    const document = await this.db.findOneByOrFail(PlantDocumentEntity, {
      id: documentId,
    });
    return (await this.toDocuments(auth, [document]))[0]!;
  }

  private async toDocuments(
    auth: CustomerAuth,
    documents: PlantDocumentEntity[],
  ): Promise<PlantDocument[]> {
    if (documents.length === 0) return [];
    const ids = documents.map((document) => document.id);
    const states = new Map(
      (
        (await this.db.query(
          'select document_id as id, state from corecheck.plant_document_states where document_id = any($1::uuid[])',
          [ids],
        )) as Array<{ id: string; state: PlantDocument['state'] }>
      ).map((row) => [row.id, row.state]),
    );
    const versions = await this.db.find(PlantDocumentVersionEntity, {
      where: ids.map((documentId) => ({ documentId })),
      order: { version: 'DESC' },
    });
    const types = new Map(
      (await this.db.find(DocumentTypeEntity)).map((type) => [type.id, type]),
    );
    const people = new Map(
      (
        await this.db.find(UserEntity, {
          where: [
            ...new Set(
              versions.flatMap((v) => [
                v.uploadedBy,
                v.verifiedBy ?? v.uploadedBy,
              ]),
            ),
          ].map((id) => ({ id })),
        })
      ).map((user) => [user.id, fullName(user)]),
    );
    const toVersion = (v: PlantDocumentVersionEntity): DocumentVersion => ({
      id: v.id,
      version: v.version,
      reference: v.reference,
      issuedOn: v.issuedOn,
      expiresOn: v.expiresOn,
      fileName: v.fileName,
      contentType: v.contentType,
      sizeBytes: v.sizeBytes,
      uploadedBy: people.get(v.uploadedBy) ?? 'Unknown',
      uploadedAt: v.uploadedAt.toISOString(),
      verification: v.verification,
      verifiedBy: v.verifiedBy ? (people.get(v.verifiedBy) ?? null) : null,
      verifiedAt: v.verifiedAt?.toISOString() ?? null,
      rejectionReason: v.rejectionReason,
    });

    return documents.map((document) => {
      const type = types.get(document.documentTypeId)!;
      const state = states.get(document.id) ?? 'awaiting_verification';
      const active = !document.archivedAt;
      const current = versions.find((v) => v.id === document.currentVersionId);
      return {
        id: document.id,
        plantId: document.plantId,
        documentType: {
          id: type.id,
          name: type.name,
          hasExpiry: type.hasExpiry,
        },
        state,
        versions: versions
          .filter((v) => v.documentId === document.id)
          .map(toVersion),
        archivedAt: document.archivedAt?.toISOString() ?? null,
        capabilities: {
          replace: active && auth.permissions.has('documents.upload'),
          verify:
            active &&
            auth.permissions.has('documents.verify') &&
            current?.verification !== 'rejected',
          archive: auth.permissions.has('documents.manage'),
        },
      };
    });
  }

  private record(
    auth: CustomerAuth,
    plant: PlantEntity,
    action: AuditAction,
    documentId: string,
    summary: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(this.db, {
      scope: 'tenant',
      orgId: auth.orgId,
      actor: userActor(auth),
      action,
      entityType: 'plant',
      entityId: plant.id,
      summary,
      metadata: { documentId, ...metadata },
    });
  }
}
