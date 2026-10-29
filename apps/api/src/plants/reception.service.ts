import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import type { z } from 'zod';
import {
  type AnswerValue,
  answerFails,
  type AuditAction,
  ERROR_CODES,
  evidenceRequired,
  type FieldError,
  type PlantReception,
  type ReceptionAnswer,
  type ReceptionCheck,
  type ReceptionEvidence,
  type saveReceptionAnswersSchema,
  type TemplateQuestion,
} from '@corecheck/shared';
import {
  type AuditActor,
  AuditService,
  userActor,
} from '../audit/audit.service.js';
import { type CustomerAuth, fullName } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import { checkDocumentFile } from '../common/document-file.js';
import {
  conflict,
  fieldError,
  forbidden,
  notFound,
  validationFailed,
} from '../common/errors.js';
import { StorageService } from '../common/storage.service.js';
import {
  CheckTemplateEntity,
  CheckTemplateVersionEntity,
  PlantEntity,
  ReceptionAnswerEntity,
  ReceptionCheckEntity,
  ReceptionEvidenceEntity,
  ReceptionSubmissionEntity,
  UserEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { TemplatesService } from '../templates/templates.service.js';
import { ComplianceService } from './compliance.service.js';
import type { UploadedFile } from './documents.service.js';
import { PlantsService } from './plants.service.js';

type AnswersInput = z.output<typeof saveReceptionAnswersSchema>['answers'];

const ACTIVE = ['open', 'returned', 'submitted'] as const;
const EDITABLE = ['open', 'returned'];

/** The value an answer of this type may hold; null clears it. */
const valueProblem = (
  question: TemplateQuestion,
  value: AnswerValue,
): string | null => {
  if (value === null || value === '') return null;
  switch (question.type) {
    case 'pass_fail':
      return value === 'pass' || value === 'fail'
        ? null
        : 'Answer pass or fail.';
    case 'yes_no':
      return value === 'yes' || value === 'no' ? null : 'Answer yes or no.';
    case 'number':
      return typeof value === 'number' ? null : 'Enter a number.';
    case 'meter':
      return typeof value === 'number' && value >= 0
        ? null
        : 'Enter the meter reading as a number of 0 or more.';
    case 'text':
      return typeof value === 'string' ? null : 'Enter text.';
    case 'photo':
      return 'Add photos for this question instead of an answer.';
  }
};

/**
 * Plant reception (FRD 8). A Supervisor, Manager or Admin assigns a
 * published reception template to Pending Reception plant (REC-002); anyone
 * allowed to complete reception within the plant's sites answers it, each
 * answer recording who gave it (REC-003, REC-008). On submission:
 *
 * - a failed question set to take plant Offline restricts it (REC-AC-01);
 * - otherwise, with automatic approval and every mandatory document valid,
 *   the plant goes Approved/Online (REC-005);
 * - otherwise it waits in Awaiting Approval for a reviewer (REC-006), who
 *   approves (documents must then be valid, DOC-AC-01) or returns the work
 *   with a comment, keeping the original submission (REC-007, REC-AC-04).
 */
@Injectable()
export class ReceptionService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly plants: PlantsService,
    private readonly templates: TemplatesService,
    private readonly compliance: ComplianceService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  private require(
    auth: CustomerAuth,
    code: Parameters<CustomerAuth['permissions']['has']>[0],
  ) {
    if (!auth.permissions.has(code)) throw forbidden();
  }

  // ------------------------------------------------------------------ read

  async forPlant(auth: CustomerAuth, plantId: string): Promise<PlantReception> {
    const plant = await this.plants.loadVisible(auth, plantId);
    const checks = await this.db.find(ReceptionCheckEntity, {
      where: { plantId },
      order: { createdAt: 'DESC' },
    });
    const versions = await this.versionsOf(checks);
    const active = checks.find((check) =>
      (ACTIVE as readonly string[]).includes(check.status),
    );
    const latest =
      active ?? checks.find((check) => check.status !== 'cancelled');
    return {
      current: latest ? await this.toCheck(auth, latest, plant) : null,
      history: checks.map((check) => {
        const { version, template } = versions.get(check.templateVersionId)!;
        return {
          id: check.id,
          status: check.status,
          templateName: template.name,
          version: version.version,
          assignedAt: check.assignedAt.toISOString(),
          submittedAt: check.submittedAt?.toISOString() ?? null,
          reviewedAt: check.reviewedAt?.toISOString() ?? null,
        };
      }),
      capabilities: {
        assign:
          auth.permissions.has('reception.assign_template') &&
          !plant.archivedAt &&
          plant.status === 'pending_reception' &&
          !active,
      },
    };
  }

  async evidenceFile(auth: CustomerAuth, checkId: string, evidenceId: string) {
    const { check } = await this.loadVisible(auth, checkId);
    const evidence = await this.db.findOneBy(ReceptionEvidenceEntity, {
      id: evidenceId,
      checkId: check.id,
    });
    if (!evidence) throw notFound('Photo');
    return {
      body: await this.storage.get(evidence.storagePath),
      contentType: evidence.contentType,
      fileName: evidence.fileName,
    };
  }

  // ----------------------------------------------------------------- write

  async assign(
    auth: CustomerAuth,
    plantId: string,
    templateId: string,
  ): Promise<PlantReception> {
    this.require(auth, 'reception.assign_template');
    const plant = await this.plants.loadVisible(auth, plantId);
    if (plant.archivedAt || plant.status !== 'pending_reception')
      throw conflict(
        ERROR_CODES.CONFLICT,
        'Reception can be assigned only to plant that is Pending Reception.',
      );
    const active = await this.db.findOneBy(ReceptionCheckEntity, {
      plantId,
      status: In([...ACTIVE]),
    });
    if (active)
      throw conflict(
        ERROR_CODES.CONFLICT,
        'This plant already has a reception check in progress.',
      );
    const { template, version } =
      await this.templates.latestPublished(templateId);
    if (template.purpose !== 'reception')
      throw fieldError('templateId', 'Choose a reception template.');
    const result = await this.db.insert(ReceptionCheckEntity, {
      orgId: this.tenantDb.orgId,
      plantId,
      templateVersionId: version.id,
      status: 'open',
      assignedBy: auth.userId,
      outcomeReasons: [],
    });
    await this.record(
      auth,
      plant,
      'reception.assigned',
      `Assigned reception ${template.name} (version ${version.version}) to ${plant.assetId}`,
      { checkId: (result.identifiers[0] as { id: string }).id },
    );
    return this.forPlant(auth, plantId);
  }

  /** Saves answers as a draft; each records who gave it (REC-008). */
  async saveAnswers(
    auth: CustomerAuth,
    checkId: string,
    answers: AnswersInput,
  ): Promise<ReceptionCheck> {
    this.require(auth, 'reception.complete');
    const { check, plant, questions } = await this.loadEditable(auth, checkId);
    const byId = new Map(questions.map((question) => [question.id, question]));
    const errors: FieldError[] = [];
    for (const answer of answers) {
      const question = byId.get(answer.questionId);
      const field = `answers.${answer.questionId}`;
      if (!question) errors.push({ field, message: 'Unknown question.' });
      else {
        const problem = valueProblem(question, answer.value);
        if (problem) errors.push({ field, message: problem });
      }
    }
    if (errors.length) throw validationFailed(errors);

    const existing = new Map(
      (await this.db.findBy(ReceptionAnswerEntity, { checkId })).map((row) => [
        row.questionId,
        row,
      ]),
    );
    const now = this.clock.now();
    for (const answer of answers) {
      const value = answer.value === '' ? null : answer.value;
      const comment = answer.comment || null;
      const current = existing.get(answer.questionId);
      if (current && current.value === value && current.comment === comment)
        continue;
      if (value === null && !comment) {
        if (current)
          await this.db.delete(ReceptionAnswerEntity, {
            checkId,
            questionId: answer.questionId,
          });
        continue;
      }
      await this.db.upsert(
        ReceptionAnswerEntity,
        {
          orgId: this.tenantDb.orgId,
          checkId,
          questionId: answer.questionId,
          value,
          comment,
          answeredBy: auth.userId,
          answeredAt: now,
        },
        ['checkId', 'questionId'],
      );
    }
    return this.toCheck(auth, check, plant);
  }

  /** A photo for a question; location and device details are removed. */
  async addEvidence(
    auth: CustomerAuth,
    checkId: string,
    questionId: string,
    upload: UploadedFile,
  ): Promise<ReceptionCheck> {
    this.require(auth, 'reception.complete');
    const { check, plant, questions } = await this.loadEditable(auth, checkId);
    if (!questions.some((question) => question.id === questionId))
      throw notFound('Question');
    const file = checkDocumentFile(upload);
    if (file.contentType === 'application/pdf')
      throw fieldError('file', 'Add a JPEG or PNG photo.');
    const result = await this.db.insert(ReceptionEvidenceEntity, {
      orgId: this.tenantDb.orgId,
      checkId,
      questionId,
      storagePath: 'pending',
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.body.length,
      uploadedBy: auth.userId,
    });
    const id = (result.identifiers[0] as { id: string }).id;
    const storagePath = `${this.tenantDb.orgId}/plants/${plant.id}/reception/${checkId}/${id}.${file.extension}`;
    await this.storage.put(storagePath, file.body, file.contentType);
    await this.db.update(ReceptionEvidenceEntity, { id }, { storagePath });
    return this.toCheck(auth, check, plant);
  }

  /** Takes a photo off the answer; the file stays for the record. */
  async removeEvidence(
    auth: CustomerAuth,
    checkId: string,
    evidenceId: string,
  ): Promise<ReceptionCheck> {
    this.require(auth, 'reception.complete');
    const { check, plant } = await this.loadEditable(auth, checkId);
    const evidence = await this.db.findOneBy(ReceptionEvidenceEntity, {
      id: evidenceId,
      checkId,
    });
    if (!evidence || evidence.removedAt) throw notFound('Photo');
    await this.db.update(
      ReceptionEvidenceEntity,
      { id: evidenceId },
      { removedAt: this.clock.now() },
    );
    return this.toCheck(auth, check, plant);
  }

  async submit(auth: CustomerAuth, checkId: string): Promise<PlantReception> {
    this.require(auth, 'reception.complete');
    const { plant, questions, version } = await this.loadEditable(
      auth,
      checkId,
    );
    const answers = new Map(
      (await this.db.findBy(ReceptionAnswerEntity, { checkId })).map((row) => [
        row.questionId,
        row,
      ]),
    );
    const photos = await this.activeEvidence(checkId);

    // Every gap at once, against its question (VAL-002).
    const errors: FieldError[] = [];
    const failed: TemplateQuestion[] = [];
    for (const question of questions) {
      const answer = answers.get(question.id);
      const value = answer?.value ?? null;
      const photoCount = photos.filter(
        (p) => p.questionId === question.id,
      ).length;
      const field = `answers.${question.id}`;
      const answered =
        question.type === 'photo' ? photoCount > 0 : value !== null;
      if (question.mandatory && !answered) {
        errors.push({
          field,
          message:
            question.type === 'photo'
              ? `Add a photo: ${question.text}`
              : `Answer: ${question.text}`,
        });
        continue;
      }
      const fails = answerFails(question, value);
      if (fails) failed.push(question);
      if (evidenceRequired(question.requireComment, fails) && !answer?.comment)
        errors.push({ field, message: `Add a comment: ${question.text}` });
      if (
        question.type !== 'photo' &&
        evidenceRequired(question.requirePhoto, fails) &&
        photoCount === 0
      )
        errors.push({ field, message: `Add a photo: ${question.text}` });
    }
    if (errors.length) throw validationFailed(errors);

    const offline = failed.filter((question) => question.offlineOnFail);
    const documents = await this.compliance.blockers(plant.id);
    const now = this.clock.now();
    let outcome: 'approved' | 'restricted' | 'awaiting_approval';
    let reasons: string[];
    if (offline.length > 0) {
      outcome = 'restricted';
      reasons = offline.map((question) => `Failed: ${question.text}`);
    } else if (version.approvalMode === 'automatic' && documents.length === 0) {
      outcome = 'approved';
      reasons = [];
    } else {
      outcome = 'awaiting_approval';
      reasons = documents.map((document) => `Document not valid: ${document}`);
    }

    await this.db.insert(ReceptionSubmissionEntity, {
      orgId: this.tenantDb.orgId,
      checkId,
      submittedBy: auth.userId,
      answers: [...answers.values()].map((answer) => ({
        questionId: answer.questionId,
        value: answer.value,
        comment: answer.comment,
        answeredBy: answer.answeredBy,
        answeredAt: answer.answeredAt.toISOString(),
        photos: photos
          .filter((photo) => photo.questionId === answer.questionId)
          .map((photo) => photo.id),
      })),
      outcome,
      outcomeReasons: reasons,
    });
    await this.db.update(
      ReceptionCheckEntity,
      { id: checkId },
      {
        status: outcome === 'awaiting_approval' ? 'submitted' : outcome,
        submittedBy: auth.userId,
        submittedAt: now,
        outcomeReasons: reasons,
        ...(outcome === 'approved' && { reviewedAt: now, reviewedBy: null }),
      },
    );
    await this.record(
      auth,
      plant,
      'reception.submitted',
      `Submitted reception for ${plant.assetId}`,
      { checkId, outcome, reasons },
    );

    if (outcome === 'restricted')
      await this.setPlantStatus(userActor(auth), plant, {
        status: 'restricted',
        note: `Reception failed: ${offline.map((question) => question.text).join('; ')}`,
        action: 'plant.restricted',
        summary: `Restricted ${plant.assetId} ${plant.name}: reception failed`,
        metadata: {
          checkId,
          automatic: true,
          failed: offline.map((q) => q.text),
        },
      });
    else if (outcome === 'approved')
      await this.setPlantStatus(userActor(auth), plant, {
        status: 'approved',
        note: null,
        approvedBy: null,
        action: 'plant.approved',
        summary: `Approved ${plant.assetId} ${plant.name}: reception passed (automatic)`,
        metadata: { checkId, automatic: true },
      });
    else
      await this.setPlantStatus(userActor(auth), plant, {
        status: 'awaiting_approval',
        note: reasons.length ? reasons.join('; ') : null,
      });
    return this.forPlant(auth, plant.id);
  }

  /** A reviewer approves submitted reception (REC-006, REC-AC-03). */
  async approve(auth: CustomerAuth, checkId: string): Promise<PlantReception> {
    this.require(auth, 'reception.approve');
    const { check, plant } = await this.loadVisible(auth, checkId);
    if (check.status !== 'submitted')
      throw conflict(
        ERROR_CODES.CONFLICT,
        'This reception is not awaiting approval.',
      );
    const documents = await this.compliance.blockers(plant.id);
    if (documents.length)
      throw conflict(
        ERROR_CODES.DOCUMENTS_NOT_VALID,
        `Mandatory documents are not valid: ${documents.join(', ')}.`,
        { documents },
      );
    const now = this.clock.now();
    await this.db.update(
      ReceptionCheckEntity,
      { id: checkId },
      { status: 'approved', reviewedBy: auth.userId, reviewedAt: now },
    );
    await this.record(
      auth,
      plant,
      'reception.approved',
      `Approved reception of ${plant.assetId}`,
      { checkId },
    );
    await this.setPlantStatus(userActor(auth), plant, {
      status: 'approved',
      note: null,
      approvedBy: auth.userId,
      action: 'plant.approved',
      summary: `Approved ${plant.assetId} ${plant.name}`,
      metadata: { checkId },
    });
    return this.forPlant(auth, plant.id);
  }

  /**
   * Sends the work back with a comment (REC-007). The plant returns to
   * Pending Reception and the earlier submission stays on record.
   */
  async returnForCorrection(
    auth: CustomerAuth,
    checkId: string,
    comment: string,
  ): Promise<PlantReception> {
    this.require(auth, 'reception.approve');
    const { check, plant } = await this.loadVisible(auth, checkId);
    const restrictedByIt =
      check.status === 'restricted' && plant.status === 'restricted';
    if (check.status !== 'submitted' && !restrictedByIt)
      throw conflict(
        ERROR_CODES.CONFLICT,
        'Only submitted reception can be returned for correction.',
      );
    await this.db.update(
      ReceptionCheckEntity,
      { id: checkId },
      {
        status: 'returned',
        reviewedBy: auth.userId,
        reviewedAt: this.clock.now(),
        reviewComment: comment,
      },
    );
    await this.record(
      auth,
      plant,
      'reception.returned',
      `Returned reception of ${plant.assetId} for correction`,
      { checkId, comment },
    );
    await this.setPlantStatus(userActor(auth), plant, {
      status: 'pending_reception',
      note: `Returned for correction: ${comment}`,
    });
    return this.forPlant(auth, plant.id);
  }

  async cancel(auth: CustomerAuth, checkId: string): Promise<PlantReception> {
    this.require(auth, 'reception.assign_template');
    const { check, plant } = await this.loadVisible(auth, checkId);
    if (!EDITABLE.includes(check.status))
      throw conflict(
        ERROR_CODES.CONFLICT,
        'Only reception that has not been submitted can be cancelled.',
      );
    await this.db.update(
      ReceptionCheckEntity,
      { id: checkId },
      { status: 'cancelled' },
    );
    await this.record(
      auth,
      plant,
      'reception.cancelled',
      `Cancelled the reception check of ${plant.assetId}`,
      { checkId },
    );
    return this.forPlant(auth, plant.id);
  }

  // ---------------------------------------------------------------- shared

  /** A check whose plant the user may see; otherwise not found. */
  private async loadVisible(auth: CustomerAuth, checkId: string) {
    const check = await this.db.findOneBy(ReceptionCheckEntity, {
      id: checkId,
    });
    if (!check) throw notFound('Reception');
    let plant: PlantEntity;
    try {
      plant = await this.plants.loadVisible(auth, check.plantId);
    } catch {
      throw notFound('Reception');
    }
    const version = await this.db.findOneByOrFail(CheckTemplateVersionEntity, {
      id: check.templateVersionId,
    });
    return { check, plant, version, questions: version.questions };
  }

  private async loadEditable(auth: CustomerAuth, checkId: string) {
    const loaded = await this.loadVisible(auth, checkId);
    if (!EDITABLE.includes(loaded.check.status))
      throw conflict(
        ERROR_CODES.CONFLICT,
        loaded.check.status === 'submitted'
          ? 'This reception has been submitted. It can change only if it is returned for correction.'
          : 'This reception is closed.',
      );
    if (loaded.plant.archivedAt)
      throw conflict(ERROR_CODES.CONFLICT, 'This plant is archived.');
    return loaded;
  }

  private activeEvidence(checkId: string) {
    return this.db
      .find(ReceptionEvidenceEntity, {
        where: { checkId },
        order: { uploadedAt: 'ASC' },
      })
      .then((rows) => rows.filter((row) => !row.removedAt));
  }

  private async setPlantStatus(
    actor: AuditActor,
    plant: PlantEntity,
    change: {
      status: PlantEntity['status'];
      note: string | null;
      approvedBy?: string | null;
      action?: AuditAction;
      summary?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const now = this.clock.now();
    await this.db.update(
      PlantEntity,
      { id: plant.id },
      {
        status: change.status,
        restrictionReason: null,
        statusNote: change.note,
        statusChangedAt: now,
        statusChangedBy: actor.type === 'user' ? actor.id : null,
        ...(change.status === 'approved' && {
          approvedAt: now,
          approvedBy: change.approvedBy ?? null,
        }),
      },
    );
    if (change.action)
      await this.audit.record(this.db, {
        scope: 'tenant',
        orgId: this.tenantDb.orgId,
        actor,
        action: change.action,
        entityType: 'plant',
        entityId: plant.id,
        summary: change.summary!,
        before: { status: plant.status },
        after: {
          status: change.status,
          ...(change.note && { note: change.note }),
        },
        metadata: change.metadata,
      });
  }

  private async versionsOf(checks: ReceptionCheckEntity[]) {
    const ids = [...new Set(checks.map((check) => check.templateVersionId))];
    if (ids.length === 0)
      return new Map<
        string,
        { version: CheckTemplateVersionEntity; template: CheckTemplateEntity }
      >();
    const versions = await this.db.findBy(CheckTemplateVersionEntity, {
      id: In(ids),
    });
    const templates = await this.db.findBy(CheckTemplateEntity, {
      id: In(versions.map((version) => version.templateId)),
    });
    return new Map(
      versions.map((version) => [
        version.id,
        {
          version,
          template: templates.find((t) => t.id === version.templateId)!,
        },
      ]),
    );
  }

  private async toCheck(
    auth: CustomerAuth,
    check: ReceptionCheckEntity,
    plant: PlantEntity,
  ): Promise<ReceptionCheck> {
    const fresh = await this.db.findOneByOrFail(ReceptionCheckEntity, {
      id: check.id,
    });
    const { version, template } = (await this.versionsOf([fresh])).get(
      fresh.templateVersionId,
    )!;
    const answers = await this.db.findBy(ReceptionAnswerEntity, {
      checkId: fresh.id,
    });
    const evidence = await this.activeEvidence(fresh.id);
    const submissions = await this.db.find(ReceptionSubmissionEntity, {
      where: { checkId: fresh.id },
      order: { submittedAt: 'DESC' },
    });
    const userIds = [
      fresh.assignedBy,
      fresh.submittedBy,
      fresh.reviewedBy,
      ...answers.map((a) => a.answeredBy),
      ...evidence.map((e) => e.uploadedBy),
      ...submissions.flatMap((s) => [
        s.submittedBy,
        ...s.answers.map((a) => a.answeredBy),
      ]),
    ].filter((id): id is string => !!id);
    const users = await this.db.findBy(UserEntity, {
      id: In([...new Set(userIds)]),
    });
    const name = (id: string | null) => {
      const user = users.find((u) => u.id === id);
      return user ? fullName(user) : 'Unknown';
    };
    const toAnswer = (a: {
      questionId: string;
      value: AnswerValue;
      comment: string | null;
      answeredBy: string;
      answeredAt: Date | string;
    }): ReceptionAnswer => ({
      questionId: a.questionId,
      value: a.value,
      comment: a.comment,
      answeredBy: name(a.answeredBy),
      answeredAt:
        typeof a.answeredAt === 'string'
          ? a.answeredAt
          : a.answeredAt.toISOString(),
    });
    const editable = EDITABLE.includes(fresh.status) && !plant.archivedAt;
    const has = (code: Parameters<CustomerAuth['permissions']['has']>[0]) =>
      auth.permissions.has(code);
    return {
      id: fresh.id,
      plantId: fresh.plantId,
      status: fresh.status,
      template: {
        id: template.id,
        name: template.name,
        version: version.version,
        approvalMode: version.approvalMode,
      },
      questions: version.questions,
      answers: answers.map(toAnswer),
      evidence: evidence.map((e): ReceptionEvidence => ({
        id: e.id,
        questionId: e.questionId,
        fileName: e.fileName,
        contentType: e.contentType,
        sizeBytes: e.sizeBytes,
        uploadedBy: name(e.uploadedBy),
        uploadedAt: e.uploadedAt.toISOString(),
      })),
      submissions: submissions.map((s) => ({
        id: s.id,
        submittedBy: name(s.submittedBy),
        submittedAt: s.submittedAt.toISOString(),
        outcome: s.outcome,
        outcomeReasons: s.outcomeReasons,
        answers: s.answers.map(toAnswer),
      })),
      assignedBy: name(fresh.assignedBy),
      assignedAt: fresh.assignedAt.toISOString(),
      submittedBy: fresh.submittedBy ? name(fresh.submittedBy) : null,
      submittedAt: fresh.submittedAt?.toISOString() ?? null,
      reviewedBy: fresh.reviewedBy ? name(fresh.reviewedBy) : null,
      reviewedAt: fresh.reviewedAt?.toISOString() ?? null,
      reviewComment: fresh.reviewComment,
      outcomeReasons: fresh.outcomeReasons,
      capabilities: {
        answer: editable && has('reception.complete'),
        submit: editable && has('reception.complete'),
        approve: fresh.status === 'submitted' && has('reception.approve'),
        returnForCorrection:
          (fresh.status === 'submitted' ||
            (fresh.status === 'restricted' && plant.status === 'restricted')) &&
          has('reception.approve'),
        cancel: editable && has('reception.assign_template'),
      },
    };
  }

  private record(
    auth: CustomerAuth,
    plant: PlantEntity,
    action: AuditAction,
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
      metadata,
    });
  }
}
