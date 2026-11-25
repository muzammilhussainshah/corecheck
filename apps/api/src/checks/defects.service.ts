import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import type { z } from 'zod';
import {
  type AuditAction,
  type DefectDetail,
  type DefectSummary,
  ERROR_CODES,
  type listDefectsQuerySchema,
  type Paginated,
  type PermissionCode,
  type VerificationState,
} from '@corecheck/shared';
import { listAuditEvents } from '../audit/audit-query.js';
import {
  type AuditActor,
  AuditService,
  userActor,
} from '../audit/audit.service.js';
import type { CustomerAuth } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import { checkDocumentFile } from '../common/document-file.js';
import { conflict, fieldError, forbidden, notFound } from '../common/errors.js';
import { escapeLike, SqlParams } from '../common/sql.js';
import { StorageService } from '../common/storage.service.js';
import {
  CheckEntity,
  CheckEvidenceEntity,
  CheckTemplateEntity,
  CheckTemplateVersionEntity,
  DefectEntity,
  DefectEvidenceEntity,
  PlantEntity,
  ReceptionEvidenceEntity,
  SiteEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PeopleService } from '../notifications/people.service.js';
import { ComplianceService } from '../plants/compliance.service.js';
import { defectRef } from '../plants/defect-raiser.service.js';
import type { UploadedFile } from '../plants/documents.service.js';
import { PlantsService } from '../plants/plants.service.js';
import { appliesToPlant } from '../templates/templates.service.js';
import { ChecksService } from './checks.service.js';
import { checkRef } from './recurrence.js';

type ListQuery = z.output<typeof listDefectsQuerySchema>;

/** Where a Defect stands against its verification check. */
const verificationState = (
  check: CheckEntity | undefined,
): VerificationState => {
  if (!check || ['cancelled', 'rejected'].includes(check.status))
    return 'not_started';
  switch (check.status) {
    case 'completed':
      return 'approved';
    case 'submitted':
      return 'awaiting_approval';
    case 'returned':
      return 'returned';
    default:
      return 'in_progress';
  }
};

/**
 * Defects and return to service (FRD 13). Defects come only from failed
 * check or reception answers with a defect trigger (DEF-002, DEF-003); this
 * service carries them through Open, In Progress and Closed (DEF-006):
 * classification and assignment (Supervisor and above), corrective work and
 * evidence (assigned Technician and above, DFW-001..003), a shorter
 * verification check before closure (DFW-004, DEF-AC-02) and reopening by
 * an authorised role. Closing a Defect never returns plant to service
 * (DEF-AC-04): that stays a separate, authorised action.
 */
@Injectable()
export class DefectsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly plants: PlantsService,
    private readonly compliance: ComplianceService,
    private readonly checks: ChecksService,
    private readonly notifications: NotificationsService,
    private readonly people: PeopleService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  private require(auth: CustomerAuth, code: PermissionCode): void {
    if (!auth.permissions.has(code)) throw forbidden();
  }

  // ------------------------------------------------------------------ read

  async list(
    auth: CustomerAuth,
    query: ListQuery,
  ): Promise<Paginated<DefectSummary>> {
    this.require(auth, 'defects.view');
    const params = new SqlParams();
    const where: string[] = [];
    if (!auth.orgWideScope)
      where.push(`p.site_id = any(${params.add([...auth.siteIds])}::uuid[])`);
    if (query.status === 'active') where.push(`d.status <> 'closed'`);
    else if (query.status) where.push(`d.status = ${params.add(query.status)}`);
    if (query.severity) where.push(`d.severity = ${params.add(query.severity)}`);
    if (query.plantId) where.push(`d.plant_id = ${params.add(query.plantId)}`);
    if (query.siteId) where.push(`p.site_id = ${params.add(query.siteId)}`);
    if (query.assignedToMe)
      where.push(`d.assignee_user_id = ${params.add(auth.userId)}`);
    if (query.search) {
      const term = params.add(`%${escapeLike(query.search)}%`);
      where.push(
        `(p.asset_id ilike ${term} or p.name ilike ${term} or d.question_text ilike ${term}
          or ('DEF-' || lpad(d.ref_no::text, 6, '0')) ilike ${term})`,
      );
    }
    const from = `from corecheck.defects d
      join corecheck.plants p on p.id = d.plant_id
      where ${where.length ? where.join(' and ') : 'true'}`;
    const [{ total }] = (await this.db.query(
      `select count(*)::int as total ${from}`,
      params.values,
    )) as [{ total: number }];
    const rows = (await this.db.query(
      `select d.id ${from}
        order by (d.status = 'closed'), array_position(array['critical', 'major', 'minor'], d.severity),
                 d.ref_no desc
        limit ${params.add(query.pageSize)} offset ${params.add((query.page - 1) * query.pageSize)}`,
      params.values,
    )) as Array<{ id: string }>;
    const defects = rows.length
      ? await this.db.findBy(DefectEntity, { id: In(rows.map((r) => r.id)) })
      : [];
    return {
      items: await this.summaries(
        rows.map((row) => defects.find((d) => d.id === row.id)!),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(auth: CustomerAuth, id: string): Promise<DefectDetail> {
    this.require(auth, 'defects.view');
    const { defect, plant } = await this.loadVisible(auth, id);
    return this.detail(auth, defect, plant);
  }

  async evidenceFile(auth: CustomerAuth, id: string, evidenceId: string) {
    this.require(auth, 'defects.view');
    const { defect } = await this.loadVisible(auth, id);
    const evidence = await this.db.findOneBy(DefectEvidenceEntity, {
      id: evidenceId,
      defectId: defect.id,
    });
    if (!evidence) throw notFound('File');
    return {
      body: await this.storage.get(evidence.storagePath),
      contentType: evidence.contentType,
      fileName: evidence.fileName,
    };
  }

  // ----------------------------------------------------------------- write

  /** Classify and assign (Appendix C): severity and/or assignee. */
  async assign(
    auth: CustomerAuth,
    id: string,
    input: { assigneeUserId?: string | null; severity?: DefectEntity['severity'] },
  ): Promise<DefectDetail> {
    this.require(auth, 'defects.assign');
    const { defect, plant } = await this.loadVisible(auth, id);
    if (defect.status === 'closed')
      throw conflict(ERROR_CODES.CONFLICT, 'This Defect is closed. Reopen it first.');
    const actor = userActor(auth);
    if (input.severity && input.severity !== defect.severity) {
      await this.db.update(DefectEntity, { id }, { severity: input.severity });
      await this.record(
        actor,
        defect,
        plant,
        'defect.classified',
        `Changed ${defectRef(defect.refNo)} from ${defect.severity} to ${input.severity}`,
        { before: defect.severity, after: input.severity },
      );
    }
    if (
      input.assigneeUserId !== undefined &&
      input.assigneeUserId !== defect.assigneeUserId
    ) {
      if (input.assigneeUserId) {
        const reached = await this.people.reached(
          { userId: input.assigneeUserId, teamId: null, disciplineId: null },
          plant.siteId,
        );
        if (!reached.includes(input.assigneeUserId))
          throw fieldError(
            'assigneeUserId',
            'Choose an active user who can see this plant’s site.',
          );
      }
      await this.db.update(
        DefectEntity,
        { id },
        { assigneeUserId: input.assigneeUserId },
      );
      const names = await this.people.names([input.assigneeUserId]);
      await this.record(
        actor,
        defect,
        plant,
        'defect.assigned',
        input.assigneeUserId
          ? `Assigned ${defectRef(defect.refNo)} to ${names.get(input.assigneeUserId)}`
          : `Unassigned ${defectRef(defect.refNo)}`,
        { before: defect.assigneeUserId, after: input.assigneeUserId },
      );
      if (input.assigneeUserId)
        await this.notifications.notify(
          [input.assigneeUserId],
          {
            kind: 'defect_assigned',
            title: `${defectRef(defect.refNo)} is assigned to you`,
            body: `${defect.severity} Defect on ${plant.assetId}: ${defect.questionText}`,
            link: `/defects/${id}`,
            entityType: 'defect',
            entityId: id,
          },
          [auth.userId],
        );
    }
    return this.get(auth, id);
  }

  /** Moves an assigned Defect to In Progress (DFW-001). */
  async start(auth: CustomerAuth, id: string): Promise<DefectDetail> {
    this.require(auth, 'defects.start');
    const { defect, plant } = await this.loadVisible(auth, id);
    this.ensureOwnWork(auth, defect);
    if (defect.status !== 'open')
      throw conflict(ERROR_CODES.CONFLICT, 'Only an open Defect can be started.');
    await this.db.update(
      DefectEntity,
      { id },
      { status: 'in_progress', startedAt: this.clock.now(), startedBy: auth.userId },
    );
    await this.record(
      userActor(auth),
      defect,
      plant,
      'defect.started',
      `Moved ${defectRef(defect.refNo)} to In Progress`,
    );
    return this.get(auth, id);
  }

  /** Corrective action and repair notes (DFW-002). */
  async recordWork(
    auth: CustomerAuth,
    id: string,
    input: { correctiveAction?: string; repairNotes?: string },
  ): Promise<DefectDetail> {
    this.require(auth, 'defects.record_work');
    const { defect, plant } = await this.loadVisible(auth, id);
    this.ensureOwnWork(auth, defect);
    this.ensureInProgress(defect);
    await this.db.update(
      DefectEntity,
      { id },
      {
        correctiveAction: input.correctiveAction || null,
        repairNotes: input.repairNotes || null,
        workRecordedBy: auth.userId,
        workRecordedAt: this.clock.now(),
      },
    );
    await this.record(
      userActor(auth),
      defect,
      plant,
      'defect.work_recorded',
      `Recorded corrective action on ${defectRef(defect.refNo)}`,
      {
        before: {
          correctiveAction: defect.correctiveAction,
          repairNotes: defect.repairNotes,
        },
        after: input,
      },
    );
    return this.get(auth, id);
  }

  async addEvidence(
    auth: CustomerAuth,
    id: string,
    upload: UploadedFile,
  ): Promise<DefectDetail> {
    this.require(auth, 'defects.record_work');
    const { defect, plant } = await this.loadVisible(auth, id);
    this.ensureOwnWork(auth, defect);
    this.ensureInProgress(defect);
    const file = checkDocumentFile(upload);
    const result = await this.db.insert(DefectEvidenceEntity, {
      orgId: this.tenantDb.orgId,
      defectId: id,
      storagePath: 'pending',
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.body.length,
      uploadedBy: auth.userId,
    });
    const evidenceId = (result.identifiers[0] as { id: string }).id;
    const storagePath = `${this.tenantDb.orgId}/plants/${plant.id}/defects/${id}/${evidenceId}.${file.extension}`;
    await this.storage.put(storagePath, file.body, file.contentType);
    await this.db.update(DefectEvidenceEntity, { id: evidenceId }, { storagePath });
    await this.record(
      userActor(auth),
      defect,
      plant,
      'defect.evidence_added',
      `Added repair evidence ${file.fileName} to ${defectRef(defect.refNo)}`,
      { evidenceId },
    );
    return this.get(auth, id);
  }

  async removeEvidence(
    auth: CustomerAuth,
    id: string,
    evidenceId: string,
  ): Promise<DefectDetail> {
    this.require(auth, 'defects.record_work');
    const { defect, plant } = await this.loadVisible(auth, id);
    this.ensureOwnWork(auth, defect);
    this.ensureInProgress(defect);
    const evidence = await this.db.findOneBy(DefectEvidenceEntity, {
      id: evidenceId,
      defectId: id,
    });
    if (!evidence || evidence.removedAt) throw notFound('File');
    await this.db.update(
      DefectEvidenceEntity,
      { id: evidenceId },
      { removedAt: this.clock.now() },
    );
    await this.record(
      userActor(auth),
      defect,
      plant,
      'defect.evidence_removed',
      `Removed repair evidence ${evidence.fileName} from ${defectRef(defect.refNo)}`,
      { evidenceId },
    );
    return this.get(auth, id);
  }

  /** Starts the Defect's verification check (DFW-004). */
  async startVerification(
    auth: CustomerAuth,
    id: string,
    templateId: string,
  ): Promise<DefectDetail> {
    this.require(auth, 'defects.verify');
    const { defect, plant } = await this.loadVisible(auth, id);
    this.ensureOwnWork(auth, defect);
    this.ensureInProgress(defect);
    const current = defect.verificationCheckId
      ? await this.db.findOneBy(CheckEntity, { id: defect.verificationCheckId })
      : null;
    if (current && !['cancelled', 'rejected'].includes(current.status))
      throw conflict(
        ERROR_CODES.CONFLICT,
        `Verification ${checkRef(current.refNo)} is already under way.`,
      );
    const check = await this.checks.startVerification(auth, defect, plant, templateId);
    await this.db.update(DefectEntity, { id }, { verificationCheckId: check.id });
    await this.record(
      userActor(auth),
      defect,
      plant,
      'defect.verification_started',
      `Started verification ${checkRef(check.refNo)} for ${defectRef(defect.refNo)}`,
      { checkId: check.id },
    );
    return this.get(auth, id);
  }

  /**
   * Closes the Defect once its verification is complete and, where the
   * template requires it, approved (DFW-010, DEF-AC-02). The plant stays as
   * it is: returning it to service is a separate action (DEF-AC-04).
   */
  async close(
    auth: CustomerAuth,
    id: string,
    note: string | undefined,
  ): Promise<DefectDetail> {
    this.require(auth, 'defects.close');
    const { defect, plant } = await this.loadVisible(auth, id);
    this.ensureOwnWork(auth, defect);
    if (defect.status === 'closed')
      throw conflict(ERROR_CODES.CONFLICT, 'This Defect is already closed.');
    const blockers = await this.closeBlockers(defect);
    if (blockers.length)
      throw conflict(
        ERROR_CODES.VERIFICATION_REQUIRED,
        `${defectRef(defect.refNo)} cannot close yet: ${blockers.join(' ')}`,
        { blockers },
      );
    await this.db.update(
      DefectEntity,
      { id },
      {
        status: 'closed',
        closedAt: this.clock.now(),
        closedBy: auth.userId,
        closeNote: note ?? null,
      },
    );
    await this.record(
      userActor(auth),
      defect,
      plant,
      'defect.closed',
      `Closed ${defectRef(defect.refNo)}${note ? `: ${note}` : ''}`,
      { note },
      true,
    );
    // Defect closure is a notification trigger (NTF-005): those who raised
    // and worked it, and those who return plant to service at its site.
    await this.notifications.notify(
      [
        defect.raisedBy,
        ...(defect.assigneeUserId ? [defect.assigneeUserId] : []),
        ...(plant.status === 'restricted'
          ? await this.people.withPermission(
              'plant_status.return_to_service',
              plant.siteId,
            )
          : []),
      ],
      {
        kind: 'defect_closed',
        title: `${defectRef(defect.refNo)} closed on ${plant.assetId}`,
        body:
          plant.status === 'restricted'
            ? `${defect.questionText}. The plant is still Restricted/Offline until it is returned to service.`
            : defect.questionText,
        link: `/defects/${id}`,
        entityType: 'defect',
        entityId: id,
      },
      [auth.userId],
    );
    return this.get(auth, id);
  }

  /**
   * Reopens a closed Defect (DEF-006). It needs a new verification before
   * it can close again; the earlier one stays on record.
   */
  async reopen(auth: CustomerAuth, id: string, reason: string): Promise<DefectDetail> {
    this.require(auth, 'defects.reopen');
    const { defect, plant } = await this.loadVisible(auth, id);
    if (defect.status !== 'closed')
      throw conflict(ERROR_CODES.CONFLICT, 'Only a closed Defect can be reopened.');
    await this.db.update(
      DefectEntity,
      { id },
      {
        status: 'open',
        reopenedAt: this.clock.now(),
        reopenedBy: auth.userId,
        reopenReason: reason,
        verificationCheckId: null,
        startedAt: null,
        startedBy: null,
      },
    );
    await this.record(
      userActor(auth),
      defect,
      plant,
      'defect.reopened',
      `Reopened ${defectRef(defect.refNo)}: ${reason}`,
      { reason, previousVerificationCheckId: defect.verificationCheckId },
      true,
    );
    return this.get(auth, id);
  }

  // ---------------------------------------------------------------- shared

  private async loadVisible(auth: CustomerAuth, id: string) {
    const defect = await this.db.findOneBy(DefectEntity, { id });
    if (!defect) throw notFound('Defect');
    const plant = await this.db.findOneBy(PlantEntity, { id: defect.plantId });
    if (!plant || !this.plants.inScope(auth, plant.siteId)) throw notFound('Defect');
    return { defect, plant };
  }

  /**
   * Technicians work on Defects assigned to them (Appendix C "assigned
   * work"); those who assign Defects may work on any within scope.
   */
  private ensureOwnWork(auth: CustomerAuth, defect: DefectEntity): void {
    if (auth.permissions.has('defects.assign')) return;
    if (defect.assigneeUserId !== auth.userId)
      throw forbidden('This Defect is assigned to someone else.');
  }

  private ensureInProgress(defect: DefectEntity): void {
    if (defect.status !== 'in_progress')
      throw conflict(
        ERROR_CODES.CONFLICT,
        defect.status === 'open'
          ? 'Move the Defect to In Progress first.'
          : 'This Defect is closed.',
      );
  }

  /** What still stops closing it (DFW-010). */
  private async closeBlockers(defect: DefectEntity): Promise<string[]> {
    if (defect.status === 'closed') return [];
    const check = defect.verificationCheckId
      ? await this.db.findOneBy(CheckEntity, { id: defect.verificationCheckId })
      : null;
    const blockers: string[] = [];
    if (defect.status === 'open') blockers.push('Move it to In Progress.');
    const state = verificationState(check ?? undefined);
    if (state === 'not_started')
      blockers.push('Complete its verification check.');
    else if (state === 'awaiting_approval')
      blockers.push('Its verification is awaiting approval.');
    else if (state !== 'approved')
      blockers.push('Complete and submit its verification check.');
    if (check) {
      const version = await this.db.findOneByOrFail(CheckTemplateVersionEntity, {
        id: check.templateVersionId,
      });
      blockers.push(
        ...(await this.checks.workGaps(defect, version)).map((gap) => gap.message),
      );
    }
    return blockers;
  }

  private async summaries(defects: DefectEntity[]): Promise<DefectSummary[]> {
    if (defects.length === 0) return [];
    const plants = await this.db.findBy(PlantEntity, {
      id: In([...new Set(defects.map((d) => d.plantId))]),
    });
    const sites = await this.db.findBy(SiteEntity, {
      id: In([...new Set(plants.map((p) => p.siteId))]),
    });
    const checkIds = [
      ...new Set(
        defects.flatMap((d) => [d.checkId, d.verificationCheckId]).filter(
          (value): value is string => !!value,
        ),
      ),
    ];
    const checks = checkIds.length
      ? await this.db.findBy(CheckEntity, { id: In(checkIds) })
      : [];
    const names = await this.people.names(
      defects.flatMap((d) => [d.raisedBy, d.assigneeUserId]),
    );
    return defects.map((defect) => {
      const plant = plants.find((p) => p.id === defect.plantId)!;
      const source = defect.checkId
        ? checks.find((c) => c.id === defect.checkId)
        : undefined;
      return {
        id: defect.id,
        ref: defectRef(defect.refNo),
        plant: {
          id: plant.id,
          assetId: plant.assetId,
          name: plant.name,
          status: plant.status,
          site: {
            id: plant.siteId,
            name: sites.find((s) => s.id === plant.siteId)?.name ?? '',
          },
        },
        severity: defect.severity,
        status: defect.status,
        questionText: defect.questionText,
        raisedBy: names.get(defect.raisedBy) ?? 'Unknown',
        raisedAt: defect.raisedAt.toISOString(),
        assignee: defect.assigneeUserId
          ? {
              id: defect.assigneeUserId,
              name: names.get(defect.assigneeUserId) ?? 'Unknown',
            }
          : null,
        verification: verificationState(
          checks.find((c) => c.id === defect.verificationCheckId),
        ),
        restrictsPlant: defect.restrictsPlant,
        source: defect.checkId
          ? {
              kind: 'check',
              id: defect.checkId,
              ref: source ? checkRef(source.refNo) : null,
            }
          : { kind: 'reception', id: defect.receptionCheckId!, ref: null },
        updatedAt: defect.updatedAt.toISOString(),
      };
    });
  }

  private async detail(
    auth: CustomerAuth,
    defect: DefectEntity,
    plant: PlantEntity,
  ): Promise<DefectDetail> {
    const fresh = await this.db.findOneByOrFail(DefectEntity, { id: defect.id });
    const [summary] = await this.summaries([fresh]);
    const evidence = (
      await this.db.find(DefectEvidenceEntity, {
        where: { defectId: fresh.id },
        order: { uploadedAt: 'ASC' },
      })
    ).filter((row) => !row.removedAt);
    // The evidence that came with the failed answer.
    const sourceEvidence = fresh.checkId
      ? (
          await this.db.findBy(CheckEvidenceEntity, {
            checkId: fresh.checkId,
            questionId: fresh.questionId,
          })
        ).filter((row) => !row.removedAt)
      : (
          await this.db.findBy(ReceptionEvidenceEntity, {
            checkId: fresh.receptionCheckId!,
            questionId: fresh.questionId,
          })
        ).filter((row) => !row.removedAt);
    const verification = fresh.verificationCheckId
      ? await this.db.findOneBy(CheckEntity, { id: fresh.verificationCheckId })
      : null;
    const verificationVersion = verification
      ? await this.db.findOneBy(CheckTemplateVersionEntity, {
          id: verification.templateVersionId,
        })
      : null;
    const names = await this.people.names([
      fresh.workRecordedBy,
      fresh.startedBy,
      fresh.closedBy,
      fresh.reopenedBy,
      ...evidence.map((e) => e.uploadedBy),
      ...sourceEvidence.map((e) => e.uploadedBy),
    ]);
    const name = (id: string | null) => (id ? (names.get(id) ?? 'Unknown') : null);
    const today = await this.compliance.today();
    const verificationTemplates = await this.verificationTemplates(plant);
    const has = (code: PermissionCode) => auth.permissions.has(code);
    const own = has('defects.assign') || fresh.assigneeUserId === auth.userId;
    const closed = fresh.status === 'closed';
    const inProgress = fresh.status === 'in_progress';
    const state = verificationState(verification ?? undefined);
    const closeBlockers = await this.closeBlockers(fresh);
    const history = await listAuditEvents(
      this.db,
      { page: 1, pageSize: 100 },
      auth.org.timeZone,
      { type: 'defect', id: fresh.id },
    );
    return {
      ...summary!,
      answer: fresh.answer,
      answerComment: fresh.answerComment,
      sourceEvidence: sourceEvidence.map((e) => ({
        id: e.id,
        questionId: e.questionId,
        fileName: e.fileName,
        contentType: e.contentType,
        sizeBytes: e.sizeBytes,
        uploadedBy: name(e.uploadedBy)!,
        uploadedAt: e.uploadedAt.toISOString(),
      })),
      correctiveAction: fresh.correctiveAction,
      repairNotes: fresh.repairNotes,
      workRecordedBy: name(fresh.workRecordedBy),
      workRecordedAt: fresh.workRecordedAt?.toISOString() ?? null,
      evidence: evidence.map((e) => ({
        id: e.id,
        fileName: e.fileName,
        contentType: e.contentType,
        sizeBytes: e.sizeBytes,
        uploadedBy: name(e.uploadedBy)!,
        uploadedAt: e.uploadedAt.toISOString(),
      })),
      verificationCheck: verification
        ? ((await this.checks.summaries([verification], today))[0] ?? null)
        : null,
      verificationTemplates,
      requireCorrectiveAction: verificationVersion?.requireCorrectiveAction ?? false,
      requireRepairEvidence: verificationVersion?.requireRepairEvidence ?? false,
      startedBy: name(fresh.startedBy),
      startedAt: fresh.startedAt?.toISOString() ?? null,
      closedBy: name(fresh.closedBy),
      closedAt: fresh.closedAt?.toISOString() ?? null,
      closeNote: fresh.closeNote,
      reopenedBy: name(fresh.reopenedBy),
      reopenedAt: fresh.reopenedAt?.toISOString() ?? null,
      reopenReason: fresh.reopenReason,
      closeBlockers,
      history: history.items,
      capabilities: {
        assign: has('defects.assign') && !closed,
        start: has('defects.start') && own && fresh.status === 'open',
        recordWork: has('defects.record_work') && own && inProgress,
        startVerification:
          has('defects.verify') &&
          own &&
          inProgress &&
          state === 'not_started' &&
          verificationTemplates.length > 0,
        close: has('defects.close') && own && !closed && closeBlockers.length === 0,
        reopen: has('defects.reopen') && closed,
      },
    };
  }

  /** Published verification templates that apply to the plant. */
  private async verificationTemplates(plant: PlantEntity) {
    const templates = await this.db.find(CheckTemplateEntity, {
      where: { purpose: 'defect_verification' },
      order: { name: 'ASC' },
    });
    const result: Array<{ id: string; name: string }> = [];
    for (const template of templates) {
      if (template.archivedAt) continue;
      const [version] = await this.db.find(CheckTemplateVersionEntity, {
        where: { templateId: template.id, state: 'published' },
        order: { version: 'DESC' },
        take: 1,
      });
      if (version && appliesToPlant(version, plant))
        result.push({ id: template.id, name: template.name });
    }
    return result;
  }

  private async record(
    actor: AuditActor,
    defect: DefectEntity,
    plant: PlantEntity,
    action: AuditAction,
    summary: string,
    metadata?: Record<string, unknown>,
    onPlantToo = false,
  ): Promise<void> {
    await this.audit.record(this.db, {
      scope: 'tenant',
      orgId: this.tenantDb.orgId,
      actor,
      action,
      entityType: 'defect',
      entityId: defect.id,
      summary,
      metadata,
    });
    if (onPlantToo)
      await this.audit.record(this.db, {
        scope: 'tenant',
        orgId: this.tenantDb.orgId,
        actor,
        action,
        entityType: 'plant',
        entityId: plant.id,
        summary: `${summary} (${plant.assetId})`,
        metadata: { ...metadata, defectId: defect.id },
      });
  }
}
