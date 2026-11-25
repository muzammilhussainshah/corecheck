import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { In, IsNull as IsNullOp } from 'typeorm';
import type { z } from 'zod';
import {
  type AuditAction,
  type CheckTemplateDetail,
  type CheckTemplateSummary,
  type createTemplateSchema,
  ERROR_CODES,
  type listTemplatesQuerySchema,
  type PermissionCode,
  type saveTemplateDraftSchema,
  type TemplateEligibility,
  type TemplateQuestion,
  type TemplateVersionDetail,
} from '@corecheck/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import { type CustomerAuth, fullName } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import { conflict, fieldError, forbidden, notFound } from '../common/errors.js';
import {
  CheckEntity,
  CheckScheduleEntity,
  CheckTemplateEntity,
  CheckTemplateVersionEntity,
  DisciplineEntity,
  MeterTypeEntity,
  PlantCategoryEntity,
  PlantEntity,
  PlantTypeEntity,
  ReceptionAnswerEntity,
  ReceptionCheckEntity,
  TeamEntity,
  UserEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';

type CreateInput = z.output<typeof createTemplateSchema>;
type DraftInput = z.output<typeof saveTemplateDraftSchema>;
type ListQuery = z.output<typeof listTemplatesQuerySchema>;

/** Every eligibility list filled in, empty meaning "no limit". */
export const eligibilityOf = (
  version: Pick<CheckTemplateVersionEntity, 'eligibility'>,
): TemplateEligibility => ({
  plantTypeIds: version.eligibility.plantTypeIds ?? [],
  categoryIds: version.eligibility.categoryIds ?? [],
  disciplineIds: version.eligibility.disciplineIds ?? [],
  teamIds: version.eligibility.teamIds ?? [],
  userIds: version.eligibility.userIds ?? [],
});

/** Whether the template's plant types and categories include this plant. */
export const appliesToPlant = (
  version: Pick<CheckTemplateVersionEntity, 'eligibility'>,
  plant: Pick<PlantEntity, 'plantTypeId' | 'categoryId'>,
): boolean => {
  const { plantTypeIds, categoryIds } = eligibilityOf(version);
  return (
    (plantTypeIds.length === 0 || plantTypeIds.includes(plant.plantTypeId)) &&
    (categoryIds.length === 0 ||
      (!!plant.categoryId && categoryIds.includes(plant.categoryId)))
  );
};

/**
 * Whether a person is among those the template lets carry out its checks
 * (TMP-008): with no limit set, everyone is; otherwise the user, one of their
 * teams or one of their disciplines must be listed.
 */
export const personEligible = (
  version: Pick<CheckTemplateVersionEntity, 'eligibility'>,
  person: {
    userId: string;
    teamIds: readonly string[];
    disciplineIds: readonly string[];
  },
): boolean => {
  const { userIds, teamIds, disciplineIds } = eligibilityOf(version);
  if (!userIds.length && !teamIds.length && !disciplineIds.length) return true;
  return (
    userIds.includes(person.userId) ||
    person.teamIds.some((id) => teamIds.includes(id)) ||
    person.disciplineIds.some((id) => disciplineIds.includes(id))
  );
};

/**
 * Check templates (FRD 10) for reception, operational, technical,
 * maintenance and Defect verification work (TMP-007). Only those allowed to
 * manage templates (Admin, TMP-001) change them. A draft can change freely;
 * publishing freezes the version (the database refuses later changes), and
 * editing a published template starts a new draft (TMP-002..004). Publishing
 * can move checks not yet started onto the new version (TMP-005); anything
 * started, submitted or completed keeps its version (TMP-006).
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get db(): EntityManager {
    return this.tenantDb.manager;
  }

  private require(auth: CustomerAuth, ...anyOf: PermissionCode[]): void {
    if (!anyOf.some((code) => auth.permissions.has(code))) throw forbidden();
  }

  async list(
    auth: CustomerAuth,
    query: ListQuery,
  ): Promise<CheckTemplateSummary[]> {
    this.require(
      auth,
      'templates.view',
      'templates.manage',
      'reception.assign_template',
    );
    const templates = await this.db.find(CheckTemplateEntity, {
      where: query.purpose ? { purpose: query.purpose } : {},
      order: { name: 'ASC' },
    });
    const versions = await this.db.find(CheckTemplateVersionEntity);
    return templates
      .filter((template) => query.includeArchived || !template.archivedAt)
      .map((template) =>
        this.summary(
          template,
          versions.filter((version) => version.templateId === template.id),
        ),
      );
  }

  async get(auth: CustomerAuth, id: string): Promise<CheckTemplateDetail> {
    this.require(
      auth,
      'templates.view',
      'templates.manage',
      'reception.assign_template',
    );
    const template = await this.load(id);
    const versions = await this.db.find(CheckTemplateVersionEntity, {
      where: { templateId: id },
      order: { version: 'DESC' },
    });
    const people = await this.people(
      versions.flatMap((version) =>
        version.publishedBy ? [version.publishedBy] : [],
      ),
    );
    const draft = versions.find((version) => version.state === 'draft');
    const published = versions.find((version) => version.state === 'published');
    return {
      ...this.summary(template, versions),
      draft: draft ? this.versionDetail(draft, people) : null,
      published: published ? this.versionDetail(published, people) : null,
      // With a draft, every published version is earlier than the one about
      // to be published; without one, all but the newest.
      unstartedChecks: await this.unstartedOn(
        versions
          .filter((version) => version.state === 'published')
          .map((version) => version.id)
          .slice(draft ? 0 : 1),
      ),
      schedules: await this.db.countBy(CheckScheduleEntity, {
        templateId: id,
        archivedAt: IsNullOp(),
      }),
      versions: versions.map((version) => ({
        version: version.version,
        state: version.state,
        publishedAt: version.publishedAt?.toISOString() ?? null,
        publishedBy: version.publishedBy
          ? (people.get(version.publishedBy) ?? null)
          : null,
      })),
    };
  }

  async create(
    auth: CustomerAuth,
    input: CreateInput,
  ): Promise<CheckTemplateDetail> {
    this.require(auth, 'templates.manage');
    const result = await this.db.insert(CheckTemplateEntity, {
      orgId: this.tenantDb.orgId,
      purpose: input.purpose,
      name: input.name,
      description: input.description || null,
      createdBy: auth.userId,
    });
    const id = (result.identifiers[0] as { id: string }).id;
    await this.db.insert(CheckTemplateVersionEntity, {
      orgId: this.tenantDb.orgId,
      templateId: id,
      version: 1,
      state: 'draft',
      approvalMode: input.approvalMode,
      questions: [],
      eligibility: {},
      separation: 'major_critical',
      requireCorrectiveAction: false,
      requireRepairEvidence: false,
      recurrence: null,
      createdBy: auth.userId,
    });
    await this.record(
      auth,
      'template.created',
      id,
      `Created template ${input.name}`,
    );
    return this.get(auth, id);
  }

  /**
   * Saves the draft. With no draft, a new one is started from the published
   * version, which itself never changes (TMP-004).
   */
  async saveDraft(
    auth: CustomerAuth,
    id: string,
    input: DraftInput,
  ): Promise<CheckTemplateDetail> {
    this.require(auth, 'templates.manage');
    if (
      input.questions &&
      !auth.permissions.has('templates.configure_questions')
    )
      throw forbidden(
        'Changing questions needs the configure-questions permission.',
      );
    const template = await this.load(id);
    if (template.archivedAt)
      throw conflict(
        ERROR_CODES.CONFLICT,
        'Restore the template before editing it.',
      );
    if (input.questions) await this.checkQuestions(input.questions);
    if (input.eligibility) await this.checkEligibility(input.eligibility);

    const draft = await this.draftOf(auth, template);
    const changes: Partial<CheckTemplateVersionEntity> = {};
    if (input.approvalMode) changes.approvalMode = input.approvalMode;
    if (input.questions) changes.questions = input.questions;
    if (input.eligibility) changes.eligibility = input.eligibility;
    if (input.separation) changes.separation = input.separation;
    if (input.requireCorrectiveAction !== undefined)
      changes.requireCorrectiveAction = input.requireCorrectiveAction;
    if (input.requireRepairEvidence !== undefined)
      changes.requireRepairEvidence = input.requireRepairEvidence;
    if (input.recurrence !== undefined) changes.recurrence = input.recurrence;
    if (Object.keys(changes).length)
      await this.db.update(
        CheckTemplateVersionEntity,
        { id: draft.id },
        changes,
      );
    const details: Partial<CheckTemplateEntity> = {};
    if (input.name && input.name !== template.name) details.name = input.name;
    if (input.description !== undefined)
      details.description = input.description || null;
    if (Object.keys(details).length)
      await this.db.update(CheckTemplateEntity, { id }, details);

    await this.record(
      auth,
      'template.updated',
      id,
      `Saved draft version ${draft.version} of ${input.name ?? template.name}`,
      { version: draft.version, questions: input.questions?.length },
    );
    return this.get(auth, id);
  }

  /**
   * Freezes the draft as the version new checks use (TMP-003). With
   * applyToUnstarted, checks of earlier versions that nobody has started or
   * answered move to it too (TMP-005, TMP-AC-03).
   */
  async publish(
    auth: CustomerAuth,
    id: string,
    applyToUnstarted = false,
  ): Promise<CheckTemplateDetail> {
    this.require(auth, 'templates.manage');
    const template = await this.load(id);
    if (template.archivedAt)
      throw conflict(
        ERROR_CODES.CONFLICT,
        'Restore the template before publishing it.',
      );
    const draft = await this.db.findOneBy(CheckTemplateVersionEntity, {
      templateId: id,
      state: 'draft',
    });
    if (!draft)
      throw conflict(ERROR_CODES.CONFLICT, 'There is no draft to publish.');
    if (draft.questions.length === 0)
      throw fieldError(
        'questions',
        'Add at least one question before publishing.',
      );
    await this.checkQuestions(draft.questions);
    await this.db.update(
      CheckTemplateVersionEntity,
      { id: draft.id },
      {
        state: 'published',
        publishedAt: this.clock.now(),
        publishedBy: auth.userId,
      },
    );
    await this.record(
      auth,
      'template.published',
      id,
      `Published version ${draft.version} of ${template.name}`,
      { version: draft.version, applyToUnstarted },
    );
    if (applyToUnstarted) {
      const moved = await this.applyToUnstarted(auth, template, draft);
      if (moved > 0)
        await this.record(
          auth,
          'template.applied_to_checks',
          id,
          `Moved ${moved} check${moved === 1 ? '' : 's'} not yet started to version ${draft.version} of ${template.name}`,
          { version: draft.version, checks: moved },
        );
    }
    return this.get(auth, id);
  }

  /** A copy of the template's latest version as a new Draft (TMP-001). */
  async duplicate(
    auth: CustomerAuth,
    id: string,
    name: string,
  ): Promise<CheckTemplateDetail> {
    this.require(auth, 'templates.manage');
    const template = await this.load(id);
    const [latest] = await this.db.find(CheckTemplateVersionEntity, {
      where: { templateId: id },
      order: { version: 'DESC' },
      take: 1,
    });
    const result = await this.db.insert(CheckTemplateEntity, {
      orgId: this.tenantDb.orgId,
      purpose: template.purpose,
      name,
      description: template.description,
      createdBy: auth.userId,
    });
    const copyId = (result.identifiers[0] as { id: string }).id;
    await this.db.insert(CheckTemplateVersionEntity, {
      orgId: this.tenantDb.orgId,
      templateId: copyId,
      version: 1,
      state: 'draft',
      approvalMode: latest?.approvalMode ?? 'manual',
      questions: latest?.questions ?? [],
      eligibility: latest?.eligibility ?? {},
      separation: latest?.separation ?? 'major_critical',
      requireCorrectiveAction: latest?.requireCorrectiveAction ?? false,
      requireRepairEvidence: latest?.requireRepairEvidence ?? false,
      recurrence: latest?.recurrence ?? null,
      createdBy: auth.userId,
    });
    await this.record(
      auth,
      'template.duplicated',
      copyId,
      `Duplicated ${template.name} as ${name}`,
      { from: id, fromVersion: latest?.version },
    );
    return this.get(auth, copyId);
  }

  /**
   * Moves checks of earlier versions that are not started, with no answer
   * given, onto the newly published version. Receptions count too.
   */
  private async applyToUnstarted(
    auth: CustomerAuth,
    template: CheckTemplateEntity,
    version: CheckTemplateVersionEntity,
  ): Promise<number> {
    const earlier = (
      await this.db.find(CheckTemplateVersionEntity, {
        where: { templateId: template.id, state: 'published' },
      })
    )
      .filter((item) => item.id !== version.id)
      .map((item) => item.id);
    if (earlier.length === 0) return 0;
    const checks = (
      await this.db.findBy(CheckEntity, {
        templateVersionId: In(earlier),
        status: In(['scheduled', 'due']),
      })
    ).filter((check) => !check.startedAt);
    let moved = 0;
    for (const check of checks) {
      const answered = await this.db.query(
        'select 1 from corecheck.check_answers where check_id = $1 limit 1',
        [check.id],
      );
      if ((answered as unknown[]).length) continue;
      await this.db.update(
        CheckEntity,
        { id: check.id },
        { templateVersionId: version.id },
      );
      await this.audit.record(this.db, {
        scope: 'tenant',
        orgId: auth.orgId,
        actor: userActor(auth),
        action: 'check.version_applied',
        entityType: 'check',
        entityId: check.id,
        summary: `Moved CHK-${String(check.refNo).padStart(6, '0')} to version ${version.version} of ${template.name}`,
        metadata: { templateId: template.id, version: version.version },
      });
      moved++;
    }
    const receptions = await this.db.findBy(ReceptionCheckEntity, {
      templateVersionId: In(earlier),
      status: 'open',
    });
    for (const reception of receptions) {
      if (await this.db.countBy(ReceptionAnswerEntity, { checkId: reception.id }))
        continue;
      await this.db.update(
        ReceptionCheckEntity,
        { id: reception.id },
        { templateVersionId: version.id },
      );
      moved++;
    }
    return moved;
  }

  private async unstartedOn(earlier: string[]): Promise<number> {
    if (earlier.length === 0) return 0;
    const [row] = (await this.db.query(
      `select count(*)::int as n from corecheck.checks c
        where c.template_version_id = any($1::uuid[])
          and c.status in ('scheduled', 'due') and c.started_at is null
          and not exists (select 1 from corecheck.check_answers a where a.check_id = c.id)`,
      [earlier],
    )) as Array<{ n: number }>;
    return row?.n ?? 0;
  }

  async setArchived(
    auth: CustomerAuth,
    id: string,
    archived: boolean,
  ): Promise<CheckTemplateDetail> {
    this.require(auth, 'templates.manage');
    const template = await this.load(id);
    if ((template.archivedAt !== null) !== archived) {
      await this.db.update(
        CheckTemplateEntity,
        { id },
        { archivedAt: archived ? this.clock.now() : null },
      );
      await this.record(
        auth,
        archived ? 'template.archived' : 'template.restored',
        id,
        `${archived ? 'Archived' : 'Restored'} template ${template.name}`,
      );
    }
    return this.get(auth, id);
  }

  /** The newest published version of an active template, for a new check. */
  async latestPublished(templateId: string): Promise<{
    template: CheckTemplateEntity;
    version: CheckTemplateVersionEntity;
  }> {
    const template = await this.db.findOneBy(CheckTemplateEntity, {
      id: templateId,
    });
    if (!template) throw fieldError('templateId', 'Template not found.');
    if (template.archivedAt)
      throw fieldError('templateId', `${template.name} is archived.`);
    const [version] = await this.db.find(CheckTemplateVersionEntity, {
      where: { templateId, state: 'published' },
      order: { version: 'DESC' },
      take: 1,
    });
    if (!version)
      throw fieldError(
        'templateId',
        `${template.name} has not been published.`,
      );
    return { template, version };
  }

  // ---------------------------------------------------------------- shared

  private async load(id: string): Promise<CheckTemplateEntity> {
    const template = await this.db.findOneBy(CheckTemplateEntity, { id });
    if (!template) throw notFound('Template');
    return template;
  }

  private async draftOf(
    auth: CustomerAuth,
    template: CheckTemplateEntity,
  ): Promise<CheckTemplateVersionEntity> {
    const draft = await this.db.findOneBy(CheckTemplateVersionEntity, {
      templateId: template.id,
      state: 'draft',
    });
    if (draft) return draft;
    const [latest] = await this.db.find(CheckTemplateVersionEntity, {
      where: { templateId: template.id },
      order: { version: 'DESC' },
      take: 1,
    });
    const result = await this.db.insert(CheckTemplateVersionEntity, {
      orgId: this.tenantDb.orgId,
      templateId: template.id,
      version: (latest?.version ?? 0) + 1,
      state: 'draft',
      approvalMode: latest?.approvalMode ?? 'manual',
      questions: latest?.questions ?? [],
      eligibility: latest?.eligibility ?? {},
      separation: latest?.separation ?? 'major_critical',
      requireCorrectiveAction: latest?.requireCorrectiveAction ?? false,
      requireRepairEvidence: latest?.requireRepairEvidence ?? false,
      recurrence: latest?.recurrence ?? null,
      createdBy: auth.userId,
    });
    return this.db.findOneByOrFail(CheckTemplateVersionEntity, {
      id: (result.identifiers[0] as { id: string }).id,
    });
  }

  /** Meter questions must read an active meter type of this organisation. */
  private async checkQuestions(questions: TemplateQuestion[]): Promise<void> {
    const meters = new Map(
      (await this.db.find(MeterTypeEntity)).map((meter) => [meter.id, meter]),
    );
    for (const [index, question] of questions.entries()) {
      if (question.type !== 'meter') continue;
      const meter = question.meterTypeId
        ? meters.get(question.meterTypeId)
        : undefined;
      if (!meter)
        throw fieldError(
          `questions.${index}.meterTypeId`,
          'Meter type not found.',
        );
      if (meter.archivedAt)
        throw fieldError(
          `questions.${index}.meterTypeId`,
          `${meter.name} is archived.`,
        );
    }
  }

  /** Every id the eligibility names must be this organisation's (TMP-008). */
  private async checkEligibility(
    eligibility: TemplateEligibility,
  ): Promise<void> {
    const lists = [
      ['plantTypeIds', PlantTypeEntity, 'Plant type'],
      ['categoryIds', PlantCategoryEntity, 'Category'],
      ['disciplineIds', DisciplineEntity, 'Discipline'],
      ['teamIds', TeamEntity, 'Team'],
      ['userIds', UserEntity, 'User'],
    ] as const;
    for (const [key, entity, label] of lists) {
      const ids = eligibility[key];
      if (!ids.length) continue;
      const found = await this.db.countBy(entity, { id: In(ids) });
      if (found !== ids.length)
        throw fieldError(`eligibility.${key}`, `${label} not found.`);
    }
  }

  private summary(
    template: CheckTemplateEntity,
    versions: CheckTemplateVersionEntity[],
  ): CheckTemplateSummary {
    const published = versions
      .filter((version) => version.state === 'published')
      .sort((a, b) => b.version - a.version)[0];
    const draft = versions.find((version) => version.state === 'draft');
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      purpose: template.purpose,
      publishedVersion: published?.version ?? null,
      hasDraft: !!draft,
      questionCount: (published ?? draft)?.questions.length ?? 0,
      archivedAt: template.archivedAt?.toISOString() ?? null,
      updatedAt: template.updatedAt.toISOString(),
    };
  }

  private versionDetail(
    version: CheckTemplateVersionEntity,
    people: Map<string, string>,
  ): TemplateVersionDetail {
    return {
      id: version.id,
      version: version.version,
      state: version.state,
      approvalMode: version.approvalMode,
      questions: version.questions,
      eligibility: eligibilityOf(version),
      separation: version.separation,
      requireCorrectiveAction: version.requireCorrectiveAction,
      requireRepairEvidence: version.requireRepairEvidence,
      recurrence: version.recurrence,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      publishedBy: version.publishedBy
        ? (people.get(version.publishedBy) ?? null)
        : null,
    };
  }

  private async people(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.db.find(UserEntity, {
      where: [...new Set(ids)].map((id) => ({ id })),
    });
    return new Map(users.map((user) => [user.id, fullName(user)]));
  }

  private record(
    auth: CustomerAuth,
    action: AuditAction,
    entityId: string,
    summary: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(this.db, {
      scope: 'tenant',
      orgId: auth.orgId,
      actor: userActor(auth),
      action,
      entityType: 'template',
      entityId,
      summary,
      metadata,
    });
  }
}
