import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import type { z } from 'zod';
import {
  type AnswerValue,
  type AuditAction,
  CHECK_PURPOSES,
  type CheckAnswer,
  type CheckDetail,
  type CheckStatus,
  type CheckSummary,
  type createCheckSchema,
  ERROR_CODES,
  type FieldError,
  type IdName,
  type listChecksQuerySchema,
  type Paginated,
  type PermissionCode,
  type reviewCheckSchema,
  type saveCheckAnswersSchema,
  type TemplateQuestion,
  type WorkSummary,
} from '@corecheck/shared';
import { listAuditEvents } from '../audit/audit-query.js';
import {
  type AuditActor,
  AuditService,
  userActor,
} from '../audit/audit.service.js';
import type { CustomerAuth } from '../auth/auth-context.js';
import {
  type AnswerLike,
  evaluateAnswers,
  valueProblem,
} from '../common/answers.js';
import { Clock } from '../common/clock.js';
import { checkDocumentFile } from '../common/document-file.js';
import {
  conflict,
  fieldError,
  forbidden,
  notFound,
  validationFailed,
} from '../common/errors.js';
import { escapeLike, SqlParams } from '../common/sql.js';
import { StorageService } from '../common/storage.service.js';
import {
  CheckAnswerChangeEntity,
  CheckAnswerEntity,
  CheckEntity,
  CheckEvidenceEntity,
  CheckScheduleEntity,
  CheckSubmissionEntity,
  CheckTemplateEntity,
  CheckTemplateVersionEntity,
  DefectEntity,
  DefectEvidenceEntity,
  DisciplineEntity,
  MeterTypeEntity,
  PlantEntity,
  SiteEntity,
  TeamEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PeopleService } from '../notifications/people.service.js';
import { ComplianceService } from '../plants/compliance.service.js';
import { DefectRaiser, defectRef } from '../plants/defect-raiser.service.js';
import type { UploadedFile } from '../plants/documents.service.js';
import { MetersService } from '../plants/meters.service.js';
import { PlantsService } from '../plants/plants.service.js';
import {
  appliesToPlant,
  personEligible,
} from '../templates/templates.service.js';
import {
  availableOnFor,
  checkRef,
  displayStatus,
  isOverdue,
} from './recurrence.js';
import { SchedulesService } from './schedules.service.js';

type CreateInput = z.output<typeof createCheckSchema>;
type ListQuery = z.output<typeof listChecksQuerySchema>;
type AnswersInput = z.output<typeof saveCheckAnswersSchema>;
type ReviewInput = z.output<typeof reviewCheckSchema>;

/** Not yet submitted: open to answers. */
const WORKABLE: readonly CheckStatus[] = ['due', 'in_progress', 'returned'];
/** Still to be done: can be reassigned or rescheduled. */
const OPEN: readonly CheckStatus[] = [
  'scheduled',
  'due',
  'in_progress',
  'returned',
];
/** Submitted work a Manager or Admin may correct (CHK-010). */
const SUBMITTED: readonly CheckStatus[] = ['submitted', 'completed'];

interface Loaded {
  check: CheckEntity;
  plant: PlantEntity;
  version: CheckTemplateVersionEntity;
  template: CheckTemplateEntity;
}

/** Does a defect verification template require separation for this severity? */
export const separationApplies = (
  rule: CheckTemplateVersionEntity['separation'],
  severity: DefectEntity['severity'],
): boolean =>
  rule === 'all' ||
  (rule === 'major_critical' && (severity === 'major' || severity === 'critical'));

/**
 * Checks (FRD 12). A check keeps its plant, template version, schedule,
 * assignees, due date, status, answers, evidence, meter readings and
 * contributors (CHK-002). Several people may answer at once: each answer is
 * saved on its own, with who gave or changed it kept for good (CHK-003,
 * CHK-004). The first valid submission wins (CHK-007); after it the check is
 * read-only except to a reviewer returning or reopening it, or a Manager or
 * Admin editing it with a reason (CHK-008..010).
 *
 * Defect verification checks (FRD 13.2) run through here too; for them,
 * doing the work needs defects.verify and approving it
 * defects.approve_verification, under separation of duties (DFW-006).
 */
@Injectable()
export class ChecksService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly plants: PlantsService,
    private readonly compliance: ComplianceService,
    private readonly schedules: SchedulesService,
    private readonly meters: MetersService,
    private readonly defects: DefectRaiser,
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
  ): Promise<Paginated<CheckSummary>> {
    this.require(auth, 'checks.view');
    const today = await this.compliance.today();
    const params = new SqlParams();
    const where: string[] = [];
    if (!auth.orgWideScope)
      where.push(`p.site_id = any(${params.add([...auth.siteIds])}::uuid[])`);
    // Added only when used: PostgreSQL cannot type an unused parameter.
    let todayParam: string | null = null;
    const t = () => (todayParam ??= `${params.add(today)}::date`);
    const workable = `c.status in ('due', 'in_progress', 'returned')`;
    switch (query.view) {
      case 'mine':
        // Work to do now; scheduled work is under Upcoming (DSH-AC-01:
        // the dashboard count matches this list).
        where.push(
          workable,
          `(c.assignee_user_id = ${params.add(auth.userId)}
            or c.assignee_team_id = any(${params.add([...auth.teamIds])}::uuid[])
            or c.assignee_discipline_id = any(${params.add([...auth.disciplineIds])}::uuid[]))`,
        );
        break;
      case 'due':
        where.push(workable, `(c.due_on is null or c.due_on >= ${t()})`);
        break;
      case 'overdue':
        where.push(workable, `c.due_on < ${t()}`);
        break;
      case 'upcoming':
        where.push(`c.status = 'scheduled'`);
        break;
      case 'review':
        where.push(`c.status = 'submitted'`);
        break;
      case 'completed':
        where.push(`c.status = 'completed'`);
        break;
      case 'all':
        break;
    }
    if (query.status === 'overdue') where.push(workable, `c.due_on < ${t()}`);
    else if (query.status) where.push(`c.status = ${params.add(query.status)}`);
    if (query.plantId) where.push(`c.plant_id = ${params.add(query.plantId)}`);
    if (query.siteId) where.push(`p.site_id = ${params.add(query.siteId)}`);
    if (query.templateId)
      where.push(`v.template_id = ${params.add(query.templateId)}`);
    if (query.defectId) where.push(`c.defect_id = ${params.add(query.defectId)}`);
    if (query.dueFrom) where.push(`c.due_on >= ${params.add(query.dueFrom)}::date`);
    if (query.dueTo) where.push(`c.due_on <= ${params.add(query.dueTo)}::date`);
    if (query.submittedFrom)
      where.push(
        `c.submitted_at >= (${params.add(query.submittedFrom)}::date::timestamp at time zone ${params.add(auth.org.timeZone)})`,
      );
    if (query.failed)
      where.push(`c.submitted_at is not null and jsonb_array_length(c.outcome_reasons) > 0`);
    if (query.withDefects)
      where.push(`exists (select 1 from corecheck.defects d where d.check_id = c.id)`);
    if (query.search) {
      const term = params.add(`%${escapeLike(query.search)}%`);
      where.push(
        `(p.asset_id ilike ${term} or p.name ilike ${term} or tp.name ilike ${term}
          or ('CHK-' || lpad(c.ref_no::text, 6, '0')) ilike ${term})`,
      );
    }
    const from = `
      from corecheck.checks c
      join corecheck.plants p on p.id = c.plant_id
      join corecheck.check_template_versions v on v.id = c.template_version_id
      join corecheck.check_templates tp on tp.id = v.template_id
      where ${where.length ? where.join(' and ') : 'true'}`;
    const [{ total }] = (await this.db.query(
      `select count(*)::int as total ${from}`,
      params.values,
    )) as [{ total: number }];
    const rows = (await this.db.query(
      `select c.id ${from}
        order by coalesce(c.status in ('due', 'in_progress', 'returned') and c.due_on < ${t()}, false) desc,
                 c.due_on asc nulls last, c.ref_no desc
        limit ${params.add(query.pageSize)} offset ${params.add((query.page - 1) * query.pageSize)}`,
      params.values,
    )) as Array<{ id: string }>;
    const checks = rows.length
      ? await this.db.findBy(CheckEntity, { id: In(rows.map((r) => r.id)) })
      : [];
    const ordered = rows.map((row) => checks.find((c) => c.id === row.id)!);
    return {
      items: await this.summaries(ordered, today),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(auth: CustomerAuth, id: string): Promise<CheckDetail> {
    this.require(auth, 'checks.view');
    return this.detail(auth, await this.loadVisible(auth, id));
  }

  /** Work counts within the user's scope, for the dashboard. */
  async summary(auth: CustomerAuth): Promise<WorkSummary> {
    const today = await this.compliance.today();
    const scopeOf = (params: SqlParams) =>
      auth.orgWideScope
        ? 'true'
        : `p.site_id = any(${params.add([...auth.siteIds])}::uuid[])`;
    const c = new SqlParams();
    const checkScope = scopeOf(c);
    const t = `${c.add(today)}::date`;
    const mine = `(c.assignee_user_id = ${c.add(auth.userId)}
      or c.assignee_team_id = any(${c.add([...auth.teamIds])}::uuid[])
      or c.assignee_discipline_id = any(${c.add([...auth.disciplineIds])}::uuid[]))`;
    const [checks] = (await this.db.query(
      `select
         count(*) filter (where c.status in ('due', 'in_progress', 'returned') and ${mine})::int as mine,
         count(*) filter (where c.status in ('due', 'in_progress', 'returned')
           and (c.due_on is null or c.due_on >= ${t}))::int as due,
         count(*) filter (where c.status in ('due', 'in_progress', 'returned')
           and c.due_on < ${t})::int as overdue,
         count(*) filter (where c.status in ('in_progress', 'returned'))::int as "inProgress",
         count(*) filter (where c.status = 'submitted')::int as "awaitingReview"
       from corecheck.checks c join corecheck.plants p on p.id = c.plant_id
      where ${checkScope}`,
      c.values,
    )) as [WorkSummary['checks']];
    const d = new SqlParams();
    const defectScope = scopeOf(d);
    const me = d.add(auth.userId);
    const [defects] = (await this.db.query(
      `select
         count(*) filter (where d.status = 'open')::int as open,
         count(*) filter (where d.status = 'in_progress')::int as "inProgress",
         count(*) filter (where d.status <> 'closed' and d.severity = 'critical')::int as critical,
         count(*) filter (where d.status <> 'closed' and d.assignee_user_id = ${me})::int as "assignedToMe"
       from corecheck.defects d join corecheck.plants p on p.id = d.plant_id
      where ${defectScope}`,
      d.values,
    )) as [WorkSummary['defects']];
    return {
      checks: auth.permissions.has('checks.view')
        ? checks
        : { mine: 0, due: 0, overdue: 0, inProgress: 0, awaitingReview: 0 },
      defects: auth.permissions.has('defects.view')
        ? defects
        : { open: 0, inProgress: 0, critical: 0, assignedToMe: 0 },
    };
  }

  async evidenceFile(auth: CustomerAuth, checkId: string, evidenceId: string) {
    this.require(auth, 'checks.view');
    const { check } = await this.loadVisible(auth, checkId);
    const evidence = await this.db.findOneBy(CheckEvidenceEntity, {
      id: evidenceId,
      checkId: check.id,
    });
    if (!evidence) throw notFound('File');
    return {
      body: await this.storage.get(evidence.storagePath),
      contentType: evidence.contentType,
      fileName: evidence.fileName,
    };
  }

  // ------------------------------------------------------- assign and plan

  /** Assigns a check outside any schedule (SCH-004). */
  async create(auth: CustomerAuth, input: CreateInput): Promise<CheckDetail> {
    this.require(auth, 'schedules.assign');
    let plant: PlantEntity;
    try {
      plant = await this.plants.loadVisible(auth, input.plantId);
    } catch {
      throw fieldError('plantId', 'Plant not found.');
    }
    if (plant.archivedAt)
      throw fieldError('plantId', `${plant.assetId} is archived.`);
    if (plant.status === 'pending_reception' || plant.status === 'awaiting_approval')
      throw fieldError(
        'plantId',
        `${plant.assetId} has not passed reception yet. Use its Reception tab.`,
      );
    const { template, version } = await this.publishedCheckTemplate(
      input.templateId,
      CHECK_PURPOSES,
      'Choose an operational, technical or maintenance template.',
    );
    if (!appliesToPlant(version, plant))
      throw fieldError(
        'templateId',
        `${template.name} does not apply to ${plant.assetId}'s plant type or category.`,
      );
    await this.schedules.checkAssignees(input, [plant]);
    const today = await this.compliance.today();
    if (input.dueOn && input.dueOn < today)
      throw fieldError('dueOn', 'Choose a due date from today on.');
    const id = await this.insertCheck({
      plantId: plant.id,
      templateVersionId: version.id,
      source: 'manual',
      scheduleId: null,
      defectId: null,
      status: 'due',
      assigneeUserId: input.assigneeUserId,
      assigneeTeamId: input.assigneeTeamId,
      assigneeDisciplineId: input.assigneeDisciplineId,
      availableOn: today,
      dueOn: input.dueOn ?? null,
      requiresReview: input.requiresReview ?? version.approvalMode === 'manual',
      separationRequired: false,
      createdBy: auth.userId,
    });
    const check = await this.db.findOneByOrFail(CheckEntity, { id });
    await this.recordCheck(
      userActor(auth),
      'check.created',
      check,
      plant,
      `Assigned ${checkRef(check.refNo)} ${template.name} on ${plant.assetId}`,
    );
    await this.announce(check, plant, template, 'check_assigned', 'is assigned to you');
    return this.get(auth, id);
  }

  /**
   * Starts the verification check of a Defect (DFW-004). Its template must
   * be a published Defect verification template that applies to the plant.
   * Approval is required when the template says so (DFW-005), and separation
   * of duties follows the template and the Defect severity (DFW-006/007).
   */
  async startVerification(
    auth: CustomerAuth,
    defect: DefectEntity,
    plant: PlantEntity,
    templateId: string,
  ): Promise<CheckEntity> {
    const { template, version } = await this.publishedCheckTemplate(
      templateId,
      ['defect_verification'],
      'Choose a Defect verification template.',
    );
    if (!appliesToPlant(version, plant))
      throw fieldError(
        'templateId',
        `${template.name} does not apply to ${plant.assetId}'s plant type or category.`,
      );
    if (!personEligible(version, auth))
      throw forbidden(
        `${template.name} is limited to other users, teams or disciplines.`,
        ERROR_CODES.NOT_ELIGIBLE,
      );
    // Work the template makes mandatory comes first (DFW-003).
    const gaps = await this.workGaps(defect, version);
    if (gaps.length) throw validationFailed(gaps);
    const requiresReview = version.approvalMode === 'manual';
    const id = await this.insertCheck({
      plantId: plant.id,
      templateVersionId: version.id,
      source: 'defect_verification',
      scheduleId: null,
      defectId: defect.id,
      status: 'due',
      assigneeUserId: auth.userId,
      assigneeTeamId: null,
      assigneeDisciplineId: null,
      availableOn: await this.compliance.today(),
      dueOn: null,
      requiresReview,
      separationRequired:
        requiresReview && separationApplies(version.separation, defect.severity),
      createdBy: auth.userId,
    });
    const check = await this.db.findOneByOrFail(CheckEntity, { id });
    await this.recordCheck(
      userActor(auth),
      'check.created',
      check,
      plant,
      `Started verification ${checkRef(check.refNo)} (${template.name}) for ${defectRef(defect.refNo)}`,
      { defectId: defect.id },
    );
    return check;
  }

  async assign(
    auth: CustomerAuth,
    id: string,
    input: {
      assigneeUserId: string | null;
      assigneeTeamId: string | null;
      assigneeDisciplineId: string | null;
    },
  ): Promise<CheckDetail> {
    this.require(auth, 'schedules.assign');
    const loaded = await this.loadVisible(auth, id);
    const { check, plant, template } = loaded;
    if (!OPEN.includes(check.status))
      throw conflict(
        ERROR_CODES.CONFLICT,
        'Only a check that is still to be done can be reassigned.',
      );
    await this.schedules.checkAssignees(input, [plant]);
    await this.db.update(CheckEntity, { id }, input);
    await this.recordCheck(
      userActor(auth),
      'check.assigned',
      check,
      plant,
      `Reassigned ${checkRef(check.refNo)}`,
      {
        before: {
          assigneeUserId: check.assigneeUserId,
          assigneeTeamId: check.assigneeTeamId,
          assigneeDisciplineId: check.assigneeDisciplineId,
        },
        after: input,
      },
    );
    if (check.status !== 'scheduled')
      await this.announce(
        { ...check, ...input },
        plant,
        template,
        'check_assigned',
        'is assigned to you',
      );
    return this.get(auth, id);
  }

  /** Moves one check; the recurring rule is untouched (SCH-004, SCH-AC-04). */
  async reschedule(
    auth: CustomerAuth,
    id: string,
    dueOn: string,
    reason: string | undefined,
  ): Promise<CheckDetail> {
    this.require(auth, 'schedules.reschedule');
    const { check, plant } = await this.loadVisible(auth, id);
    if (!OPEN.includes(check.status))
      throw conflict(
        ERROR_CODES.CONFLICT,
        'Only a check that is still to be done can be rescheduled.',
      );
    const today = await this.compliance.today();
    if (dueOn < today)
      throw fieldError('dueOn', 'Choose a due date from today on.');
    const schedule = check.scheduleId
      ? await this.db.findOneBy(CheckScheduleEntity, { id: check.scheduleId })
      : null;
    const availableOn = schedule ? availableOnFor(dueOn, schedule) : check.availableOn;
    const status: CheckStatus =
      check.status === 'scheduled' || check.status === 'due'
        ? !availableOn || availableOn <= today
          ? 'due'
          : 'scheduled'
        : check.status;
    await this.db.update(
      CheckEntity,
      { id },
      { dueOn, availableOn, status, overdueNotifiedAt: null },
    );
    await this.recordCheck(
      userActor(auth),
      'check.rescheduled',
      check,
      plant,
      `Rescheduled ${checkRef(check.refNo)} from ${check.dueOn ?? 'no due date'} to ${dueOn}${reason ? `: ${reason}` : ''}`,
      { before: check.dueOn, after: dueOn, reason },
    );
    return this.get(auth, id);
  }

  // ------------------------------------------------------------- answering

  /**
   * Saves answers as they are given (CHK-005). Each changed answer records
   * who gave it, and the change is kept (CHK-004). With a reason, a Manager
   * or Admin can change a submitted check; the original stays (CHK-010).
   */
  async saveAnswers(
    auth: CustomerAuth,
    id: string,
    input: AnswersInput,
  ): Promise<CheckDetail> {
    const loaded = await this.loadVisible(auth, id);
    const { check, version, plant } = loaded;
    const afterSubmission = SUBMITTED.includes(check.status);
    if (afterSubmission) {
      // Read-only to contributors once submitted (CHK-008).
      if (!auth.permissions.has('checks.edit_submitted'))
        throw conflict(
          ERROR_CODES.CONFLICT,
          'This check has been submitted. It can change only if it is returned or reopened.',
        );
      if (!input.reason)
        throw fieldError('reason', 'Give the reason for changing a submitted check.');
    } else {
      this.ensureWorkable(auth, loaded);
    }
    const questions = version.questions;
    const byId = new Map(questions.map((question) => [question.id, question]));
    const errors: FieldError[] = [];
    for (const answer of input.answers) {
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
      (await this.db.findBy(CheckAnswerEntity, { checkId: id })).map((row) => [
        row.questionId,
        row,
      ]),
    );
    const now = this.clock.now();
    const changed: string[] = [];
    for (const answer of input.answers) {
      const value = answer.value === '' ? null : answer.value;
      const comment = answer.comment || null;
      const current = existing.get(answer.questionId);
      if (
        (current?.value ?? null) === value &&
        (current?.comment ?? null) === comment
      )
        continue;
      changed.push(answer.questionId);
      await this.db.insert(CheckAnswerChangeEntity, {
        orgId: this.tenantDb.orgId,
        checkId: id,
        questionId: answer.questionId,
        previousValue: current?.value ?? null,
        previousComment: current?.comment ?? null,
        value,
        comment,
        changedBy: auth.userId,
        changedAt: now,
        afterSubmission,
        reason: afterSubmission ? input.reason! : null,
      });
      if (value === null && !comment) {
        await this.db.delete(CheckAnswerEntity, {
          checkId: id,
          questionId: answer.questionId,
        });
        continue;
      }
      await this.db.upsert(
        CheckAnswerEntity,
        {
          orgId: this.tenantDb.orgId,
          checkId: id,
          questionId: answer.questionId,
          value,
          comment,
          answeredBy: auth.userId,
          answeredAt: now,
        },
        ['checkId', 'questionId'],
      );
    }
    if (changed.length && !afterSubmission) await this.markStarted(auth, loaded);
    if (changed.length && afterSubmission) {
      await this.recordCheck(
        userActor(auth),
        'check.edited',
        check,
        plant,
        `Edited ${changed.length} submitted answer${changed.length === 1 ? '' : 's'} of ${checkRef(check.refNo)}: ${input.reason}`,
        { questionIds: changed, reason: input.reason },
      );
      // A changed answer that now fails still raises its Defect and takes
      // the plant Offline: the trigger answer has been recorded (TMP-AC-04).
      const answers = await this.answerMap(id);
      const evidence = await this.activeEvidence(id);
      const { failed } = evaluateAnswers(
        questions,
        answers,
        (questionId) => evidence.filter((e) => e.questionId === questionId).length,
      );
      const newlyFailed = failed.filter((q) => changed.includes(q.id));
      await this.applyFailures(userActor(auth), loaded, newlyFailed, answers);
    }
    return this.get(auth, id);
  }

  /** A photo or file for a question (EVD-001, EVD-002); GPS data removed. */
  async addEvidence(
    auth: CustomerAuth,
    id: string,
    questionId: string,
    upload: UploadedFile,
  ): Promise<CheckDetail> {
    const loaded = await this.loadVisible(auth, id);
    this.ensureWorkable(auth, loaded);
    const { check, plant, version } = loaded;
    if (!version.questions.some((question) => question.id === questionId))
      throw notFound('Question');
    const file = checkDocumentFile(upload);
    const result = await this.db.insert(CheckEvidenceEntity, {
      orgId: this.tenantDb.orgId,
      checkId: id,
      questionId,
      storagePath: 'pending',
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.body.length,
      uploadedBy: auth.userId,
    });
    const evidenceId = (result.identifiers[0] as { id: string }).id;
    const storagePath = `${this.tenantDb.orgId}/plants/${plant.id}/checks/${check.id}/${evidenceId}.${file.extension}`;
    await this.storage.put(storagePath, file.body, file.contentType);
    await this.db.update(CheckEvidenceEntity, { id: evidenceId }, { storagePath });
    await this.markStarted(auth, loaded);
    return this.get(auth, id);
  }

  /** Takes a file off the answer; it stays for the record. */
  async removeEvidence(
    auth: CustomerAuth,
    id: string,
    evidenceId: string,
  ): Promise<CheckDetail> {
    const loaded = await this.loadVisible(auth, id);
    this.ensureWorkable(auth, loaded);
    const evidence = await this.db.findOneBy(CheckEvidenceEntity, {
      id: evidenceId,
      checkId: id,
    });
    if (!evidence || evidence.removedAt) throw notFound('File');
    await this.db.update(
      CheckEvidenceEntity,
      { id: evidenceId },
      { removedAt: this.clock.now(), removedBy: auth.userId },
    );
    return this.get(auth, id);
  }

  // ------------------------------------------------------------ submission

  /**
   * Submits the check. Blocked until every mandatory question and required
   * evidence is complete, naming each gap (CHK-006, CHK-AC-01). The check row
   * is locked first, so of two people submitting at once only the first
   * succeeds; the second is refused and changes nothing (CHK-007, CHK-AC-03).
   */
  async submit(auth: CustomerAuth, id: string): Promise<CheckDetail> {
    const visible = await this.loadVisible(auth, id);
    await this.db.query('select id from corecheck.checks where id = $1 for update', [
      id,
    ]);
    const check = await this.db.findOneByOrFail(CheckEntity, { id });
    const loaded: Loaded = { ...visible, check };
    if (['submitted', 'completed', 'rejected'].includes(check.status)) {
      const names = await this.people.names([check.submittedBy]);
      throw conflict(
        ERROR_CODES.ALREADY_SUBMITTED,
        `This check was already submitted by ${names.get(check.submittedBy ?? '') ?? 'someone else'} at ${check.submittedAt?.toISOString() ?? 'an earlier time'}. Your submission was not applied; open the check to see the submitted record.`,
        {
          submittedBy: names.get(check.submittedBy ?? '') ?? null,
          submittedAt: check.submittedAt?.toISOString() ?? null,
        },
      );
    }
    this.ensureWorkable(auth, loaded);
    const { plant, version, template } = loaded;
    const questions = version.questions;
    const answers = await this.answerMap(id);
    const evidence = await this.activeEvidence(id);
    const evaluation = evaluateAnswers(
      questions,
      answers,
      (questionId) => evidence.filter((e) => e.questionId === questionId).length,
    );
    const errors: FieldError[] = [...evaluation.errors];
    for (const question of evaluation.asked) {
      const answer = answers.get(question.id);
      if (
        question.type !== 'meter' ||
        !question.meterTypeId ||
        typeof answer?.value !== 'number'
      )
        continue;
      const meter = await this.db.findOneBy(MeterTypeEntity, {
        id: question.meterTypeId,
      });
      if (!meter) continue;
      const drop = await this.meters.decrease(
        plant.id,
        meter,
        answer.value,
        answer.answeredAt,
      );
      if (drop)
        errors.push({
          field: `answers.${question.id}`,
          message: drop.message.replace(
            'give the reason',
            'record that on the Meter readings tab with the reason first',
          ),
        });
    }
    let defect: DefectEntity | null = null;
    if (check.defectId) {
      defect = await this.db.findOneByOrFail(DefectEntity, { id: check.defectId });
      errors.push(...(await this.workGaps(defect, version)));
    }
    if (errors.length) throw validationFailed(errors);

    const now = this.clock.now();
    const awaitingReview = check.requiresReview;
    const reasons = evaluation.failed.map((question) => `Failed: ${question.text}`);
    await this.db.insert(CheckSubmissionEntity, {
      orgId: this.tenantDb.orgId,
      checkId: id,
      submittedBy: auth.userId,
      answers: [...answers.values()].map((answer) => ({
        questionId: answer.questionId,
        value: answer.value,
        comment: answer.comment,
        answeredBy: answer.answeredBy,
        answeredAt: answer.answeredAt.toISOString(),
        evidence: evidence
          .filter((item) => item.questionId === answer.questionId)
          .map((item) => item.id),
      })),
      outcome: awaitingReview ? 'awaiting_review' : 'completed',
      outcomeReasons: reasons,
    });
    await this.db.update(
      CheckEntity,
      { id },
      {
        status: awaitingReview ? 'submitted' : 'completed',
        submittedAt: now,
        submittedBy: auth.userId,
        completedAt: awaitingReview ? null : now,
        outcomeReasons: reasons,
        ...(!check.startedAt && { startedAt: now, startedBy: auth.userId }),
      },
    );
    const ref = checkRef(check.refNo);
    await this.recordCheck(
      userActor(auth),
      'check.submitted',
      check,
      plant,
      `Submitted ${ref} ${template.name} on ${plant.assetId}${reasons.length ? ` — ${reasons.join('; ')}` : ''}`,
      { outcome: awaitingReview ? 'awaiting_review' : 'completed', reasons },
      true,
    );
    await this.applyFailures(userActor(auth), loaded, evaluation.failed, answers);

    if (!awaitingReview) await this.finish(userActor(auth), loaded, answers, evaluation.asked);
    // The next scheduled check counts from the completion date (SCH-009).
    await this.schedules.advance(userActor(auth), check, await this.compliance.today());
    if (awaitingReview) await this.askForReview(loaded, defect);
    return this.get(auth, id);
  }

  /**
   * Review (CHK-009): approve, reject, or return for correction with a
   * comment. Approving a verification needs someone who did not take part in
   * it when separation applies (DFW-006, DEF-AC-03); an authorised override
   * may pass that, with a reason, and is kept in the audit (DFW-009).
   */
  async review(
    auth: CustomerAuth,
    id: string,
    input: ReviewInput,
  ): Promise<CheckDetail> {
    const loaded = await this.loadVisible(auth, id);
    const { check, plant, template, version } = loaded;
    this.require(auth, this.reviewPermission(check));
    if (check.status !== 'submitted')
      throw conflict(ERROR_CODES.CONFLICT, 'This check is not awaiting review.');
    const now = this.clock.now();
    const ref = checkRef(check.refNo);
    const actor = userActor(auth);
    if (input.decision === 'approve') {
      const contributors = await this.contributorIds(id);
      const blocked = check.separationRequired && contributors.has(auth.userId);
      if (blocked && !input.override)
        throw conflict(
          ERROR_CODES.SEPARATION_REQUIRED,
          'You took part in this verification, so another person must approve it (separation of duties).',
        );
      if (blocked && !auth.permissions.has('defects.override_restriction'))
        throw forbidden(
          'Overriding separation of duties needs the Defect override permission.',
        );
      await this.db.update(
        CheckEntity,
        { id },
        {
          status: 'completed',
          completedAt: now,
          reviewedAt: now,
          reviewedBy: auth.userId,
          reviewComment: input.comment ?? null,
          reviewOverrideReason: blocked ? input.comment! : null,
        },
      );
      await this.recordCheck(actor, 'check.approved', check, plant, `Approved ${ref}`, {
        comment: input.comment,
        override: blocked,
      });
      if (check.defectId) {
        const defect = await this.db.findOneByOrFail(DefectEntity, {
          id: check.defectId,
        });
        if (blocked)
          await this.recordDefect(
            actor,
            defect,
            'defect.verification_override',
            `Approved verification ${ref} of ${defectRef(defect.refNo)} despite separation of duties: ${input.comment}`,
            { checkId: id, reason: input.comment },
          );
        await this.recordDefect(
          actor,
          defect,
          'defect.verification_approved',
          `Verification ${ref} of ${defectRef(defect.refNo)} approved`,
          { checkId: id },
        );
      }
      const answers = await this.answerMap(id);
      await this.finish(actor, loaded, answers, this.asked(version.questions, answers));
    } else if (input.decision === 'reject') {
      await this.db.update(
        CheckEntity,
        { id },
        {
          status: 'rejected',
          reviewedAt: now,
          reviewedBy: auth.userId,
          reviewComment: input.comment!,
        },
      );
      await this.recordCheck(
        actor,
        'check.rejected',
        check,
        plant,
        `Rejected ${ref}: ${input.comment}`,
        { comment: input.comment },
      );
      await this.tellContributors(loaded, 'check_returned', `${ref} was rejected`, input.comment!);
    } else {
      await this.db.update(
        CheckEntity,
        { id },
        {
          status: 'returned',
          reviewedAt: now,
          reviewedBy: auth.userId,
          reviewComment: input.comment!,
        },
      );
      await this.recordCheck(
        actor,
        'check.returned',
        check,
        plant,
        `Returned ${ref} for correction: ${input.comment}`,
        { comment: input.comment },
      );
      await this.tellContributors(
        loaded,
        'check_returned',
        `${ref} was returned for correction`,
        `${template.name} on ${plant.assetId}: ${input.comment}`,
      );
    }
    return this.get(auth, id);
  }

  /** Sends submitted work back for correction (CHK-010), with a reason. */
  async reopen(auth: CustomerAuth, id: string, reason: string): Promise<CheckDetail> {
    this.require(auth, 'checks.reopen');
    const loaded = await this.loadVisible(auth, id);
    const { check, plant, template } = loaded;
    if (!['submitted', 'completed', 'rejected'].includes(check.status))
      throw conflict(ERROR_CODES.CONFLICT, 'Only a submitted check can be reopened.');
    if (check.defectId) {
      const defect = await this.db.findOneByOrFail(DefectEntity, { id: check.defectId });
      if (defect.status === 'closed')
        throw conflict(
          ERROR_CODES.CONFLICT,
          `${defectRef(defect.refNo)} is closed. Reopen the Defect to verify it again.`,
        );
      if (defect.verificationCheckId !== check.id)
        throw conflict(
          ERROR_CODES.CONFLICT,
          'A newer verification has replaced this one.',
        );
    }
    await this.db.update(
      CheckEntity,
      { id },
      {
        status: 'returned',
        completedAt: null,
        reviewedAt: this.clock.now(),
        reviewedBy: auth.userId,
        reviewComment: reason,
      },
    );
    await this.recordCheck(
      userActor(auth),
      'check.reopened',
      check,
      plant,
      `Reopened ${checkRef(check.refNo)}: ${reason}`,
      { reason, previousStatus: check.status },
    );
    await this.tellContributors(
      loaded,
      'check_returned',
      `${checkRef(check.refNo)} was reopened`,
      `${template.name} on ${plant.assetId}: ${reason}`,
    );
    return this.get(auth, id);
  }

  /** Cancels or voids a check with a reason (CHK-011). */
  async cancel(auth: CustomerAuth, id: string, reason: string): Promise<CheckDetail> {
    this.require(auth, 'checks.cancel');
    const { check, plant } = await this.loadVisible(auth, id);
    if (['completed', 'rejected', 'cancelled'].includes(check.status))
      throw conflict(ERROR_CODES.CONFLICT, 'This check is already finished.');
    await this.db.update(
      CheckEntity,
      { id },
      {
        status: 'cancelled',
        cancelledAt: this.clock.now(),
        cancelledBy: auth.userId,
        cancelReason: reason,
      },
    );
    await this.recordCheck(
      userActor(auth),
      'check.cancelled',
      check,
      plant,
      `Cancelled ${checkRef(check.refNo)}: ${reason}`,
      { reason, previousStatus: check.status },
    );
    // A cancelled scheduled check moves the schedule on one interval from
    // its due date; a submitted one already did.
    if (check.status !== 'submitted')
      await this.schedules.advance(
        userActor(auth),
        check,
        check.dueOn ?? (await this.compliance.today()),
      );
    return this.get(auth, id);
  }

  async recordExport(auth: CustomerAuth, id: string): Promise<CheckDetail> {
    this.require(auth, 'checks.export');
    const detail = await this.get(auth, id);
    const loaded = await this.loadVisible(auth, id);
    await this.recordCheck(
      userActor(auth),
      'check.exported',
      loaded.check,
      loaded.plant,
      `Exported ${detail.ref}`,
    );
    return detail;
  }

  // ---------------------------------------------------------------- shared

  /** A check whose plant the user may see; otherwise not found. */
  async loadVisible(auth: CustomerAuth, id: string): Promise<Loaded> {
    const check = await this.db.findOneBy(CheckEntity, { id });
    if (!check) throw notFound('Check');
    const plant = await this.db.findOneBy(PlantEntity, { id: check.plantId });
    if (!plant || !this.plants.inScope(auth, plant.siteId)) throw notFound('Check');
    const version = await this.db.findOneByOrFail(CheckTemplateVersionEntity, {
      id: check.templateVersionId,
    });
    const template = await this.db.findOneByOrFail(CheckTemplateEntity, {
      id: version.templateId,
    });
    return { check, plant, version, template };
  }

  private performPermission(check: CheckEntity): PermissionCode {
    return check.source === 'defect_verification' ? 'defects.verify' : 'checks.perform';
  }

  private reviewPermission(check: CheckEntity): PermissionCode {
    return check.source === 'defect_verification'
      ? 'defects.approve_verification'
      : 'checks.review';
  }

  private assignedTo(auth: CustomerAuth, check: CheckEntity): boolean {
    return (
      check.assigneeUserId === auth.userId ||
      (!!check.assigneeTeamId && auth.teamIds.includes(check.assigneeTeamId)) ||
      (!!check.assigneeDisciplineId &&
        auth.disciplineIds.includes(check.assigneeDisciplineId))
    );
  }

  /**
   * Who may answer (CHK-001, Appendix C "assigned/available work"): the
   * assignees, or anyone who assigns such work within scope; and only people
   * the template allows (TMP-008).
   */
  private workProblem(auth: CustomerAuth, loaded: Loaded): string | null {
    const { check, plant, version } = loaded;
    if (!auth.permissions.has(this.performPermission(check)))
      return 'You do not have permission to do that.';
    if (plant.archivedAt) return 'This plant is archived.';
    const manager =
      check.source === 'defect_verification'
        ? auth.permissions.has('defects.assign')
        : auth.permissions.has('schedules.assign');
    if (!this.assignedTo(auth, check) && !manager)
      return 'This check is assigned to someone else.';
    if (!personEligible(version, auth))
      return 'This template is limited to other users, teams or disciplines.';
    return null;
  }

  private ensureWorkable(auth: CustomerAuth, loaded: Loaded): void {
    const { check } = loaded;
    if (!WORKABLE.includes(check.status))
      throw conflict(
        ERROR_CODES.CONFLICT,
        check.status === 'scheduled'
          ? `This check is not due yet. It opens on ${check.availableOn}.`
          : check.status === 'submitted'
            ? 'This check has been submitted. It can change only if it is returned or reopened.'
            : 'This check is closed.',
      );
    const problem = this.workProblem(auth, loaded);
    if (problem)
      throw forbidden(
        problem,
        problem.startsWith('This template')
          ? ERROR_CODES.NOT_ELIGIBLE
          : ERROR_CODES.FORBIDDEN,
      );
  }

  private async markStarted(auth: CustomerAuth, loaded: Loaded): Promise<void> {
    const { check, plant } = loaded;
    if (check.status !== 'due') return;
    await this.db.update(
      CheckEntity,
      { id: check.id, status: 'due' },
      { status: 'in_progress', startedAt: this.clock.now(), startedBy: auth.userId },
    );
    await this.recordCheck(
      userActor(auth),
      'check.started',
      check,
      plant,
      `Started ${checkRef(check.refNo)}`,
    );
    loaded.check = { ...check, status: 'in_progress' };
  }

  private async insertCheck(
    values: Omit<
      CheckEntity,
      | 'id'
      | 'orgId'
      | 'refNo'
      | 'startedAt'
      | 'startedBy'
      | 'submittedAt'
      | 'submittedBy'
      | 'reviewedAt'
      | 'reviewedBy'
      | 'reviewComment'
      | 'reviewOverrideReason'
      | 'completedAt'
      | 'cancelledAt'
      | 'cancelledBy'
      | 'cancelReason'
      | 'overdueNotifiedAt'
      | 'outcomeReasons'
      | 'createdAt'
      | 'updatedAt'
    >,
  ): Promise<string> {
    const result = await this.db.insert(CheckEntity, {
      ...values,
      orgId: this.tenantDb.orgId,
      outcomeReasons: [],
    });
    return (result.identifiers[0] as { id: string }).id;
  }

  private async publishedCheckTemplate(
    templateId: string,
    purposes: readonly string[],
    wrongPurpose: string,
  ) {
    const template = await this.db.findOneBy(CheckTemplateEntity, { id: templateId });
    if (!template) throw fieldError('templateId', 'Template not found.');
    if (template.archivedAt)
      throw fieldError('templateId', `${template.name} is archived.`);
    if (!purposes.includes(template.purpose))
      throw fieldError('templateId', wrongPurpose);
    const [version] = await this.db.find(CheckTemplateVersionEntity, {
      where: { templateId, state: 'published' },
      order: { version: 'DESC' },
      take: 1,
    });
    // A Draft can never generate a production check (TMP-AC-01).
    if (!version)
      throw fieldError('templateId', `${template.name} has not been published.`);
    return { template, version };
  }

  private async answerMap(checkId: string) {
    return new Map(
      (await this.db.findBy(CheckAnswerEntity, { checkId })).map((row) => [
        row.questionId,
        row,
      ]),
    );
  }

  private asked(
    questions: TemplateQuestion[],
    answers: ReadonlyMap<string, AnswerLike>,
  ): TemplateQuestion[] {
    return evaluateAnswers(questions, answers, () => 1).asked;
  }

  private activeEvidence(checkId: string) {
    return this.db
      .find(CheckEvidenceEntity, { where: { checkId }, order: { uploadedAt: 'ASC' } })
      .then((rows) => rows.filter((row) => !row.removedAt));
  }

  /** Everyone who answered, changed an answer, added evidence or submitted. */
  private async contributorIds(checkId: string): Promise<Set<string>> {
    const check = await this.db.findOneByOrFail(CheckEntity, { id: checkId });
    const answers = await this.db.findBy(CheckAnswerEntity, { checkId });
    const changes = await this.db.findBy(CheckAnswerChangeEntity, { checkId });
    const evidence = await this.db.findBy(CheckEvidenceEntity, { checkId });
    return new Set(
      [
        check.submittedBy,
        ...answers.map((a) => a.answeredBy),
        ...changes.filter((c) => !c.afterSubmission).map((c) => c.changedBy),
        ...evidence.map((e) => e.uploadedBy),
      ].filter((id): id is string => !!id),
    );
  }

  /**
   * Corrective action and repair evidence the verification template makes
   * mandatory must be on the Defect before verification is submitted (DFW-003).
   */
  async workGaps(
    defect: DefectEntity,
    version: CheckTemplateVersionEntity,
  ): Promise<FieldError[]> {
    const gaps: FieldError[] = [];
    if (version.requireCorrectiveAction && !defect.correctiveAction)
      gaps.push({
        field: 'correctiveAction',
        message: `Record the corrective action on ${defectRef(defect.refNo)} first.`,
      });
    if (version.requireRepairEvidence) {
      const active = (
        await this.db.findBy(DefectEvidenceEntity, { defectId: defect.id })
      ).filter((row) => !row.removedAt).length;
      if (active === 0)
        gaps.push({
          field: 'evidence',
          message: `Add repair evidence to ${defectRef(defect.refNo)} first.`,
        });
    }
    return gaps;
  }

  /**
   * What failed answers do once recorded: a defect trigger raises a Defect
   * (DEF-002) and an offline trigger takes the plant Restricted/Offline.
   */
  private async applyFailures(
    actor: AuditActor,
    loaded: Loaded,
    failed: TemplateQuestion[],
    answers: ReadonlyMap<string, AnswerLike & { answeredBy: string }>,
  ): Promise<void> {
    const { check, plant } = loaded;
    if (failed.length === 0) return;
    const ref = checkRef(check.refNo);
    await this.defects.raise(
      actor,
      plant,
      { kind: 'check', id: check.id, ref },
      failed,
      answers,
    );
    const offline = failed.filter((question) => question.offlineOnFail);
    if (offline.length === 0) return;
    const fresh = await this.db.findOneByOrFail(PlantEntity, { id: plant.id });
    const note = `${ref} failed: ${offline.map((q) => q.text).join('; ')}`;
    await this.db.update(
      PlantEntity,
      { id: plant.id },
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
      entityId: plant.id,
      summary: `Restricted ${plant.assetId} ${plant.name}: ${note}`,
      before: { status: fresh.status },
      after: { status: 'restricted', note },
      metadata: { checkId: check.id, automatic: true, failed: offline.map((q) => q.text) },
    });
  }

  /** A completed check puts its meter readings on the plant (MTR-003). */
  private async finish(
    actor: AuditActor,
    loaded: Loaded,
    answers: Map<string, CheckAnswerEntity>,
    asked: TemplateQuestion[],
  ): Promise<void> {
    const { check, plant } = loaded;
    await this.meters.recordFromCheck(
      actor,
      plant,
      { id: check.id, ref: checkRef(check.refNo) },
      asked,
      [...answers.values()],
    );
    if (check.defectId) {
      const defect = await this.db.findOneByOrFail(DefectEntity, { id: check.defectId });
      if (!check.requiresReview)
        await this.recordDefect(
          actor,
          defect,
          'defect.verification_approved',
          `Verification ${checkRef(check.refNo)} of ${defectRef(defect.refNo)} completed`,
          { checkId: check.id },
        );
    }
  }

  /**
   * Tells reviewers there is work to review. For a verification under
   * separation of duties, only people who took no part count; with none,
   * the Defect waits and Managers and Admins are told (DFW-008).
   */
  private async askForReview(loaded: Loaded, defect: DefectEntity | null): Promise<void> {
    const { check, plant, template } = loaded;
    const permission = this.reviewPermission(check);
    const contributors = await this.contributorIds(check.id);
    const reviewers = (await this.people.withPermission(permission, plant.siteId)).filter(
      (id) => !contributors.has(id),
    );
    const ref = checkRef(check.refNo);
    if (reviewers.length > 0) {
      await this.notifications.notify(reviewers, {
        kind: defect ? 'verification_awaiting_approval' : 'check_awaiting_review',
        title: defect
          ? `${ref}: verification of ${defectRef(defect.refNo)} awaits approval`
          : `${ref} awaits review`,
        body: `${template.name} on ${plant.assetId}.`,
        link: `/checks/${check.id}`,
        entityType: 'check',
        entityId: check.id,
      });
      return;
    }
    if (!defect || !check.separationRequired) return;
    const managers = await this.people.withPermission(
      'defects.override_restriction',
      plant.siteId,
    );
    await this.notifications.notify(managers, {
      kind: 'verification_no_approver',
      title: `${defectRef(defect.refNo)}: no separate approver available`,
      body: `Everyone able to approve verification ${ref} on ${plant.assetId} took part in it. The Defect stays awaiting approval and the plant stays out of service until someone else approves it, or an authorised override is used.`,
      link: `/checks/${check.id}`,
      entityType: 'defect',
      entityId: defect.id,
    });
    await this.recordDefect(
      SYSTEM,
      defect,
      'defect.no_approver',
      `No separate approver is available for verification ${ref} of ${defectRef(defect.refNo)}; Managers and Admins told`,
      { checkId: check.id, notified: managers.length },
    );
  }

  private async tellContributors(
    loaded: Loaded,
    kind: 'check_returned',
    title: string,
    body: string,
  ): Promise<void> {
    const contributors = await this.contributorIds(loaded.check.id);
    await this.notifications.notify(contributors, {
      kind,
      title,
      body,
      link: `/checks/${loaded.check.id}`,
      entityType: 'check',
      entityId: loaded.check.id,
    });
  }

  private async announce(
    check: Pick<
      CheckEntity,
      'id' | 'refNo' | 'dueOn' | 'assigneeUserId' | 'assigneeTeamId' | 'assigneeDisciplineId'
    >,
    plant: PlantEntity,
    template: CheckTemplateEntity,
    kind: 'check_assigned',
    what: string,
  ): Promise<void> {
    await this.notifications.notify(
      await this.people.reached(
        {
          userId: check.assigneeUserId,
          teamId: check.assigneeTeamId,
          disciplineId: check.assigneeDisciplineId,
        },
        plant.siteId,
      ),
      {
        kind,
        title: `${checkRef(check.refNo)} ${what}`,
        body: `${template.name} on ${plant.assetId}${check.dueOn ? `, due ${check.dueOn}` : ''}.`,
        link: `/checks/${check.id}`,
        entityType: 'check',
        entityId: check.id,
      },
      [this.tenantDb.userId],
    );
  }

  async summaries(checks: CheckEntity[], today: string): Promise<CheckSummary[]> {
    if (checks.length === 0) return [];
    const plants = await this.db.findBy(PlantEntity, {
      id: In([...new Set(checks.map((c) => c.plantId))]),
    });
    const sites = await this.db.findBy(SiteEntity, {
      id: In([...new Set(plants.map((p) => p.siteId))]),
    });
    const versions = await this.db.findBy(CheckTemplateVersionEntity, {
      id: In([...new Set(checks.map((c) => c.templateVersionId))]),
    });
    const templates = await this.db.findBy(CheckTemplateEntity, {
      id: In([...new Set(versions.map((v) => v.templateId))]),
    });
    const scheduleIds = checks.flatMap((c) => (c.scheduleId ? [c.scheduleId] : []));
    const schedules = scheduleIds.length
      ? await this.db.findBy(CheckScheduleEntity, { id: In([...new Set(scheduleIds)]) })
      : [];
    const defectIds = checks.flatMap((c) => (c.defectId ? [c.defectId] : []));
    const defects = defectIds.length
      ? await this.db.findBy(DefectEntity, { id: In([...new Set(defectIds)]) })
      : [];
    const teams = await this.db.find(TeamEntity);
    const disciplines = await this.db.find(DisciplineEntity);
    const people = await this.people.names(checks.map((c) => c.assigneeUserId));
    const ref = (list: IdName[], id: string | null) => {
      const item = id ? list.find((entry) => entry.id === id) : undefined;
      return item ? { id: item.id, name: item.name } : null;
    };
    return checks.map((check) => {
      const plant = plants.find((p) => p.id === check.plantId)!;
      const version = versions.find((v) => v.id === check.templateVersionId)!;
      const template = templates.find((t) => t.id === version.templateId)!;
      const schedule = schedules.find((s) => s.id === check.scheduleId);
      const defect = defects.find((d) => d.id === check.defectId);
      return {
        id: check.id,
        ref: checkRef(check.refNo),
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
        template: {
          id: template.id,
          name: template.name,
          purpose: template.purpose,
          version: version.version,
        },
        source: check.source,
        status: check.status,
        displayStatus: displayStatus(check.status, check.dueOn, today),
        overdue: isOverdue(check.status, check.dueOn, today),
        availableOn: check.availableOn,
        dueOn: check.dueOn,
        assignee: {
          user: check.assigneeUserId
            ? {
                id: check.assigneeUserId,
                name: people.get(check.assigneeUserId) ?? 'Unknown',
              }
            : null,
          team: ref(teams, check.assigneeTeamId),
          discipline: ref(disciplines, check.assigneeDisciplineId),
        },
        requiresReview: check.requiresReview,
        schedule: schedule ? { id: schedule.id, name: schedule.name } : null,
        defect: defect ? { id: defect.id, ref: defectRef(defect.refNo) } : null,
        startedAt: check.startedAt?.toISOString() ?? null,
        submittedAt: check.submittedAt?.toISOString() ?? null,
        completedAt: check.completedAt?.toISOString() ?? null,
        updatedAt: check.updatedAt.toISOString(),
      };
    });
  }

  private async detail(auth: CustomerAuth, loaded: Loaded): Promise<CheckDetail> {
    const check = await this.db.findOneByOrFail(CheckEntity, { id: loaded.check.id });
    const current: Loaded = { ...loaded, check };
    const today = await this.compliance.today();
    const [summary] = await this.summaries([check], today);
    const answers = await this.db.findBy(CheckAnswerEntity, { checkId: check.id });
    const evidence = await this.activeEvidence(check.id);
    const changes = await this.db.find(CheckAnswerChangeEntity, {
      where: { checkId: check.id },
      order: { changedAt: 'ASC', id: 'ASC' },
    });
    const submissions = await this.db.find(CheckSubmissionEntity, {
      where: { checkId: check.id },
      order: { submittedAt: 'DESC' },
    });
    const raised = await this.db.find(DefectEntity, {
      where: { checkId: check.id },
      order: { refNo: 'ASC' },
    });
    const names = await this.people.names([
      check.createdBy,
      check.startedBy,
      check.submittedBy,
      check.reviewedBy,
      check.cancelledBy,
      ...answers.map((a) => a.answeredBy),
      ...evidence.map((e) => e.uploadedBy),
      ...changes.map((c) => c.changedBy),
      ...submissions.flatMap((s) => [s.submittedBy, ...s.answers.map((a) => a.answeredBy)]),
    ]);
    const name = (id: string | null) => (id ? (names.get(id) ?? 'Unknown') : null);
    const toAnswer = (a: {
      questionId: string;
      value: AnswerValue;
      comment: string | null;
      answeredBy: string;
      answeredAt: Date | string;
    }): CheckAnswer => ({
      questionId: a.questionId,
      value: a.value,
      comment: a.comment,
      answeredBy: name(a.answeredBy)!,
      answeredAt:
        typeof a.answeredAt === 'string' ? a.answeredAt : a.answeredAt.toISOString(),
    });

    // Contributors and the questions each touched (EVD-003).
    const touched = new Map<string, Set<string>>();
    const touch = (userId: string, questionId: string) => {
      const set = touched.get(userId) ?? new Set<string>();
      set.add(questionId);
      touched.set(userId, set);
    };
    for (const change of changes) touch(change.changedBy, change.questionId);
    for (const item of evidence) touch(item.uploadedBy, item.questionId);
    for (const answer of answers) touch(answer.answeredBy, answer.questionId);
    const order = loaded.version.questions.map((q) => q.id);
    const contributors = [...touched.entries()].map(([userId, set]) => ({
      name: name(userId)!,
      questionIds: order.filter((id) => set.has(id)),
    }));

    const has = (code: PermissionCode) => auth.permissions.has(code);
    const workable = WORKABLE.includes(check.status) && !this.workProblem(auth, current);
    const contributorSet = await this.contributorIds(check.id);
    const separationBlocked =
      check.status === 'submitted' &&
      check.separationRequired &&
      contributorSet.has(auth.userId);
    const canReview = check.status === 'submitted' && has(this.reviewPermission(check));
    let reopenable = has('checks.reopen') && ['submitted', 'completed', 'rejected'].includes(check.status);
    if (reopenable && check.defectId) {
      const defect = await this.db.findOneBy(DefectEntity, { id: check.defectId });
      reopenable = !!defect && defect.status !== 'closed' && defect.verificationCheckId === check.id;
    }
    const open = OPEN.includes(check.status);
    return {
      ...summary!,
      questions: loaded.version.questions,
      answers: answers.map(toAnswer),
      evidence: evidence.map((e) => ({
        id: e.id,
        questionId: e.questionId,
        fileName: e.fileName,
        contentType: e.contentType,
        sizeBytes: e.sizeBytes,
        uploadedBy: name(e.uploadedBy)!,
        uploadedAt: e.uploadedAt.toISOString(),
      })),
      changes: changes.map((c) => ({
        questionId: c.questionId,
        previousValue: c.previousValue,
        previousComment: c.previousComment,
        value: c.value,
        comment: c.comment,
        changedBy: name(c.changedBy)!,
        changedAt: c.changedAt.toISOString(),
        afterSubmission: c.afterSubmission,
        reason: c.reason,
      })),
      submissions: submissions.map((s) => ({
        id: s.id,
        submittedBy: name(s.submittedBy)!,
        submittedAt: s.submittedAt.toISOString(),
        outcome: s.outcome,
        outcomeReasons: s.outcomeReasons,
        answers: s.answers.map(toAnswer),
      })),
      contributors,
      createdBy: name(check.createdBy),
      createdAt: check.createdAt.toISOString(),
      startedBy: name(check.startedBy),
      submittedBy: name(check.submittedBy),
      reviewedBy: name(check.reviewedBy),
      reviewedAt: check.reviewedAt?.toISOString() ?? null,
      reviewComment: check.reviewComment,
      reviewOverrideReason: check.reviewOverrideReason,
      cancelledBy: name(check.cancelledBy),
      cancelledAt: check.cancelledAt?.toISOString() ?? null,
      cancelReason: check.cancelReason,
      outcomeReasons: check.outcomeReasons,
      separationRequired: check.separationRequired,
      defectsRaised: raised.map((d) => ({
        id: d.id,
        ref: defectRef(d.refNo),
        questionId: d.questionId,
        severity: d.severity,
        status: d.status,
      })),
      reviewBlock: separationBlocked
        ? 'You took part in this verification, so another person must approve it (separation of duties).'
        : null,
      history: (
        await listAuditEvents(
          this.db,
          { page: 1, pageSize: 100 },
          auth.org.timeZone,
          { type: 'check', id: check.id },
        )
      ).items,
      capabilities: {
        answer: workable,
        submit: workable,
        review: canReview && !separationBlocked,
        override: canReview && separationBlocked && has('defects.override_restriction'),
        reopen: reopenable,
        editSubmitted: has('checks.edit_submitted') && SUBMITTED.includes(check.status),
        cancel:
          has('checks.cancel') && !['completed', 'rejected', 'cancelled'].includes(check.status),
        assign: has('schedules.assign') && open,
        reschedule: has('schedules.reschedule') && open,
        export: has('checks.export'),
      },
    };
  }

  private recordCheck(
    actor: AuditActor,
    action: AuditAction,
    check: CheckEntity,
    plant: PlantEntity,
    summary: string,
    metadata?: Record<string, unknown>,
    onPlantToo = false,
  ): Promise<void> {
    const write = (entityType: string, entityId: string) =>
      this.audit.record(this.db, {
        scope: 'tenant',
        orgId: this.tenantDb.orgId,
        actor,
        action,
        entityType,
        entityId,
        summary,
        metadata: { ...metadata, checkId: check.id },
      });
    return onPlantToo
      ? write('check', check.id).then(() => write('plant', plant.id))
      : write('check', check.id);
  }

  private recordDefect(
    actor: AuditActor,
    defect: DefectEntity,
    action: AuditAction,
    summary: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(this.db, {
      scope: 'tenant',
      orgId: this.tenantDb.orgId,
      actor,
      action,
      entityType: 'defect',
      entityId: defect.id,
      summary,
      metadata,
    });
  }
}

const SYSTEM: AuditActor = { type: 'system', id: null, name: 'CoreCheck' };
