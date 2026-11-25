import { Injectable } from '@nestjs/common';
import type { EntityManager, FindOptionsWhere } from 'typeorm';
import { In, IsNull } from 'typeorm';
import type { z } from 'zod';
import {
  type AuditAction,
  CHECK_PURPOSES,
  type CheckSchedule,
  type createScheduleSchema,
  ERROR_CODES,
  type IdName,
  type listSchedulesQuerySchema,
  type PermissionCode,
  type ScheduleState,
  type updateScheduleSchema,
} from '@corecheck/shared';
import {
  type AuditActor,
  AuditService,
  userActor,
} from '../audit/audit.service.js';
import type { CustomerAuth } from '../auth/auth-context.js';
import { Clock } from '../common/clock.js';
import { conflict, fieldError, forbidden, notFound } from '../common/errors.js';
import {
  CheckEntity,
  CheckScheduleEntity,
  CheckTemplateEntity,
  CheckTemplateVersionEntity,
  DisciplineEntity,
  PlantEntity,
  SiteEntity,
  TeamEntity,
  UserEntity,
} from '../database/entities.js';
import { TenantDb } from '../database/db-context.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PeopleService } from '../notifications/people.service.js';
import { ComplianceService } from '../plants/compliance.service.js';
import { PlantsService } from '../plants/plants.service.js';
import { appliesToPlant } from '../templates/templates.service.js';
import {
  availableOnFor,
  checkRef,
  describeRecurrence,
  displayStatus,
  nextAfter,
} from './recurrence.js';

type CreateInput = z.output<typeof createScheduleSchema>;
type UpdateInput = z.output<typeof updateScheduleSchema>;
type ListQuery = z.output<typeof listSchedulesQuerySchema>;

/** Recorded as the actor of work the schedule does by itself. */
export const SCHEDULE_ACTOR: AuditActor = {
  type: 'system',
  id: null,
  name: 'Check schedule',
};

/** Checks waiting to be done; a schedule has at most one at a time. */
export const WAITING = ['scheduled', 'due', 'in_progress'] as const;

/**
 * Recurring check schedules (FRD 11). Admin creates, edits and pauses the
 * rules (SCH-001); each belongs to one plant and one template, repeats
 * daily to annually or at a custom interval (SCH-002) from its own start date
 * (SCH-003). A schedule keeps one check waiting at a time: the next is due
 * one interval after the last was completed (SCH-009), or after its due date
 * on a fixed cycle. While the plant is out of service the schedule pauses and
 * resumes from the return-to-service date (SCH-010; the database trigger
 * plant_schedules_follow_status does this whatever changes the status).
 */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly plants: PlantsService,
    private readonly compliance: ComplianceService,
    private readonly notifications: NotificationsService,
    private readonly people: PeopleService,
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

  async list(auth: CustomerAuth, query: ListQuery): Promise<CheckSchedule[]> {
    this.require(auth, 'schedules.view');
    const where: FindOptionsWhere<CheckScheduleEntity> = {};
    if (query.plantId) where.plantId = query.plantId;
    if (query.templateId) where.templateId = query.templateId;
    if (!query.includeArchived) where.archivedAt = IsNull();
    const schedules = await this.db.find(CheckScheduleEntity, {
      where,
      order: { nextDueOn: 'ASC', name: 'ASC' },
    });
    const plants = await this.plantsById(schedules.map((s) => s.plantId));
    const visible = schedules.filter((schedule) => {
      const plant = plants.get(schedule.plantId);
      return plant && this.plants.inScope(auth, plant.siteId);
    });
    return this.toSchedules(auth, visible, plants);
  }

  async get(auth: CustomerAuth, id: string): Promise<CheckSchedule> {
    this.require(auth, 'schedules.view');
    const schedule = await this.loadVisible(auth, id);
    const plants = await this.plantsById([schedule.plantId]);
    return (await this.toSchedules(auth, [schedule], plants))[0]!;
  }

  // ----------------------------------------------------------------- write

  async create(
    auth: CustomerAuth,
    input: CreateInput,
  ): Promise<CheckSchedule[]> {
    this.require(auth, 'schedules.manage_rules');
    const { template, version } = await this.publishedTemplate(
      input.templateId,
    );
    const plants: PlantEntity[] = [];
    for (const [index, plantId] of input.plantIds.entries()) {
      let plant: PlantEntity;
      try {
        plant = await this.plants.loadVisible(auth, plantId);
      } catch {
        throw fieldError(`plantIds.${index}`, 'Plant not found.');
      }
      if (plant.archivedAt)
        throw fieldError(`plantIds.${index}`, `${plant.assetId} is archived.`);
      if (!appliesToPlant(version, plant))
        throw fieldError(
          `plantIds.${index}`,
          `${template.name} does not apply to ${plant.assetId}: its plant type or category is not one the template lists.`,
        );
      plants.push(plant);
    }
    await this.checkAssignees(input, plants);

    const created: string[] = [];
    for (const plant of plants) {
      const result = await this.db.insert(CheckScheduleEntity, {
        orgId: this.tenantDb.orgId,
        name: input.name,
        templateId: template.id,
        plantId: plant.id,
        frequency: input.frequency,
        customUnit: input.frequency === 'custom' ? input.customUnit : null,
        customCount: input.frequency === 'custom' ? input.customCount : null,
        basis: input.basis,
        startOn: input.startOn,
        nextDueOn: input.startOn,
        requiresApproval: input.requiresApproval,
        assigneeUserId: input.assigneeUserId,
        assigneeTeamId: input.assigneeTeamId,
        assigneeDisciplineId: input.assigneeDisciplineId,
        createdBy: auth.userId,
      });
      const id = (result.identifiers[0] as { id: string }).id;
      created.push(id);
      const summary = `Created schedule ${input.name} (${describeRecurrence(input)}, from ${input.startOn}) for ${plant.assetId} using ${template.name}`;
      await this.record(userActor(auth), 'schedule.created', id, summary, {
        plantId: plant.id,
        templateId: template.id,
      });
      await this.recordOnPlant(userActor(auth), 'schedule.created', plant, summary);
      await this.generate(userActor(auth), id);
    }
    const all = await this.db.findBy(CheckScheduleEntity, { id: In(created) });
    return this.toSchedules(
      auth,
      all,
      await this.plantsById(all.map((schedule) => schedule.plantId)),
    );
  }

  /**
   * Changes the rule (SCH-001). It applies from the next check generated;
   * the check already waiting keeps its due date (reschedule it instead).
   */
  async update(
    auth: CustomerAuth,
    id: string,
    input: UpdateInput,
  ): Promise<CheckSchedule> {
    this.require(auth, 'schedules.manage_rules');
    const schedule = await this.loadVisible(auth, id);
    if (schedule.archivedAt)
      throw conflict(ERROR_CODES.CONFLICT, 'This schedule has ended.');
    const plant = await this.db.findOneByOrFail(PlantEntity, {
      id: schedule.plantId,
    });
    await this.checkAssignees(input, [plant]);
    const generated = await this.db.countBy(CheckEntity, { scheduleId: id });
    const changes: Partial<CheckScheduleEntity> = {
      name: input.name,
      frequency: input.frequency,
      customUnit: input.frequency === 'custom' ? input.customUnit : null,
      customCount: input.frequency === 'custom' ? input.customCount : null,
      basis: input.basis,
      startOn: input.startOn,
      requiresApproval: input.requiresApproval,
      assigneeUserId: input.assigneeUserId,
      assigneeTeamId: input.assigneeTeamId,
      assigneeDisciplineId: input.assigneeDisciplineId,
      // Before its first check the start date still decides the first due date.
      ...(generated === 0 && { nextDueOn: input.startOn }),
    };
    await this.db.update(CheckScheduleEntity, { id }, changes);
    const before = this.ruleOf(schedule);
    const after = this.ruleOf({ ...schedule, ...changes });
    await this.record(
      userActor(auth),
      'schedule.updated',
      id,
      `Changed schedule ${input.name} for ${plant.assetId}`,
      { before, after },
    );
    await this.generate(userActor(auth), id);
    return this.get(auth, id);
  }

  /**
   * Pauses the rule (SCH-001). A check not yet due is withdrawn; one already
   * due stays with its assignees. History is kept.
   */
  async pause(
    auth: CustomerAuth,
    id: string,
    reason: string,
  ): Promise<CheckSchedule> {
    this.require(auth, 'schedules.manage_rules');
    const schedule = await this.loadVisible(auth, id);
    if (schedule.archivedAt)
      throw conflict(ERROR_CODES.CONFLICT, 'This schedule has ended.');
    if (schedule.pausedAt)
      throw conflict(ERROR_CODES.CONFLICT, 'This schedule is already paused.');
    await this.db.update(
      CheckScheduleEntity,
      { id },
      { pausedAt: this.clock.now(), pausedBy: auth.userId, pauseReason: reason },
    );
    await this.withdrawScheduled(userActor(auth), id, 'Schedule paused');
    await this.record(
      userActor(auth),
      'schedule.paused',
      id,
      `Paused schedule ${schedule.name}: ${reason}`,
      { reason },
    );
    return this.get(auth, id);
  }

  async resume(auth: CustomerAuth, id: string): Promise<CheckSchedule> {
    this.require(auth, 'schedules.manage_rules');
    const schedule = await this.loadVisible(auth, id);
    if (schedule.archivedAt)
      throw conflict(ERROR_CODES.CONFLICT, 'This schedule has ended.');
    if (!schedule.pausedAt)
      throw conflict(ERROR_CODES.CONFLICT, 'This schedule is not paused.');
    const today = await this.compliance.today();
    await this.db.update(
      CheckScheduleEntity,
      { id },
      {
        pausedAt: null,
        pausedBy: null,
        pauseReason: null,
        nextDueOn: schedule.nextDueOn < today ? today : schedule.nextDueOn,
      },
    );
    await this.record(
      userActor(auth),
      'schedule.resumed',
      id,
      `Resumed schedule ${schedule.name}`,
    );
    await this.generate(userActor(auth), id);
    return this.get(auth, id);
  }

  /** Ends the rule; its history and generated checks stay on record. */
  async end(auth: CustomerAuth, id: string): Promise<CheckSchedule> {
    this.require(auth, 'schedules.manage_rules');
    const schedule = await this.loadVisible(auth, id);
    if (schedule.archivedAt) return this.get(auth, id);
    await this.db.update(
      CheckScheduleEntity,
      { id },
      { archivedAt: this.clock.now() },
    );
    await this.withdrawScheduled(userActor(auth), id, 'Schedule ended');
    await this.record(
      userActor(auth),
      'schedule.archived',
      id,
      `Ended schedule ${schedule.name}`,
    );
    return this.get(auth, id);
  }

  // ------------------------------------------------------- the schedule runs

  /**
   * Generates the next check of each schedule that has none waiting: not
   * paused or ended, its plant Approved/Online, its template published and
   * still applying to the plant. Returns how many were generated.
   */
  async generate(actor: AuditActor, scheduleId?: string): Promise<number> {
    const today = await this.compliance.today();
    const candidates = (await this.db.query(
      `select s.id
         from corecheck.check_schedules s
         join corecheck.plants p on p.id = s.plant_id
         join corecheck.check_templates t on t.id = s.template_id
        where s.archived_at is null and s.paused_at is null
          and s.plant_paused_at is null
          and p.status = 'approved' and p.archived_at is null
          and t.archived_at is null
          and ($1::uuid is null or s.id = $1)
          and not exists (
            select 1 from corecheck.checks c
             where c.schedule_id = s.id
               and c.status in ('scheduled', 'due', 'in_progress'))`,
      [scheduleId ?? null],
    )) as Array<{ id: string }>;
    let generated = 0;
    for (const { id } of candidates) {
      const schedule = await this.db.findOneByOrFail(CheckScheduleEntity, {
        id,
      });
      const [version] = await this.db.find(CheckTemplateVersionEntity, {
        where: { templateId: schedule.templateId, state: 'published' },
        order: { version: 'DESC' },
        take: 1,
      });
      const plant = await this.db.findOneByOrFail(PlantEntity, {
        id: schedule.plantId,
      });
      if (!version || !appliesToPlant(version, plant)) continue;
      const availableOn = availableOnFor(schedule.nextDueOn, schedule);
      const due = availableOn <= today;
      const result = (await this.db
        .createQueryBuilder()
        .insert()
        .into(CheckEntity)
        .values({
          orgId: this.tenantDb.orgId,
          plantId: plant.id,
          templateVersionId: version.id,
          source: 'schedule',
          scheduleId: schedule.id,
          defectId: null,
          status: due ? 'due' : 'scheduled',
          assigneeUserId: schedule.assigneeUserId,
          assigneeTeamId: schedule.assigneeTeamId,
          assigneeDisciplineId: schedule.assigneeDisciplineId,
          availableOn,
          dueOn: schedule.nextDueOn,
          requiresReview: schedule.requiresApproval,
          separationRequired: false,
          createdBy: null,
          outcomeReasons: [],
        })
        .orIgnore()
        .returning(['id', 'refNo'])
        .execute()) as { raw: Array<{ id: string; ref_no: number }> };
      const row = result.raw[0];
      if (!row) continue;
      generated++;
      const ref = checkRef(row.ref_no);
      await this.audit.record(this.db, {
        scope: 'tenant',
        orgId: this.tenantDb.orgId,
        actor,
        action: 'check.generated',
        entityType: 'check',
        entityId: row.id,
        summary: `Generated ${ref} from schedule ${schedule.name} for ${plant.assetId}, due ${schedule.nextDueOn}`,
        metadata: { scheduleId: schedule.id, plantId: plant.id },
      });
      if (due) await this.announceDue([row.id]);
    }
    return generated;
  }

  /** Scheduled checks whose time has come become Due (SCH-006). */
  async makeDue(): Promise<number> {
    const today = await this.compliance.today();
    const rows = (await this.db.query(
      `update corecheck.checks set status = 'due'
        where status = 'scheduled' and available_on <= $1
        returning id`,
      [today],
    )) as [Array<{ id: string }>, number];
    const ids = rows[0].map((row) => row.id);
    if (ids.length) await this.announceDue(ids);
    return ids.length;
  }

  /**
   * Overdue work (SCH-007, SCH-008): once per check, its assignees and the
   * Supervisors, Managers and Admins who manage overdue work at its site are
   * told. Returns how many checks became overdue.
   */
  async flagOverdue(): Promise<number> {
    const today = await this.compliance.today();
    const checks = (await this.db.query(
      `select c.id, c.ref_no as "refNo", c.due_on::text as "dueOn",
              c.assignee_user_id as "userId", c.assignee_team_id as "teamId",
              c.assignee_discipline_id as "disciplineId",
              p.site_id as "siteId", p.asset_id as "assetId", t.name as "templateName"
         from corecheck.checks c
         join corecheck.plants p on p.id = c.plant_id
         join corecheck.check_template_versions v on v.id = c.template_version_id
         join corecheck.check_templates t on t.id = v.template_id
        where c.status in ('due', 'in_progress', 'returned')
          and c.due_on < $1 and c.overdue_notified_at is null`,
      [today],
    )) as Array<{
      id: string;
      refNo: number;
      dueOn: string;
      userId: string | null;
      teamId: string | null;
      disciplineId: string | null;
      siteId: string;
      assetId: string;
      templateName: string;
    }>;
    for (const check of checks) {
      const recipients = [
        ...(await this.people.reached(check, check.siteId)),
        ...(await this.people.withPermission(
          'schedules.manage_overdue',
          check.siteId,
        )),
      ];
      await this.notifications.notify(recipients, {
        kind: 'check_overdue',
        title: `${checkRef(check.refNo)} is overdue`,
        body: `${check.templateName} on ${check.assetId} was due ${check.dueOn}.`,
        link: `/checks/${check.id}`,
        entityType: 'check',
        entityId: check.id,
      });
      await this.db.update(
        CheckEntity,
        { id: check.id },
        { overdueNotifiedAt: this.clock.now() },
      );
    }
    return checks.length;
  }

  /**
   * After a scheduled check is submitted, cancelled or voided: the next
   * check is due one interval after `from` (the completion date on a
   * completion basis, else the due date), never before today.
   */
  async advance(
    actor: AuditActor,
    check: CheckEntity,
    completedOn: string,
  ): Promise<void> {
    if (!check.scheduleId) return;
    const schedule = await this.db.findOneBy(CheckScheduleEntity, {
      id: check.scheduleId,
    });
    if (!schedule) return;
    const from =
      schedule.basis === 'due_date' && check.dueOn ? check.dueOn : completedOn;
    let next = nextAfter(from, schedule);
    const today = await this.compliance.today();
    while (schedule.basis === 'due_date' && next < today)
      next = nextAfter(next, schedule);
    if (next < today) next = today;
    await this.db.update(
      CheckScheduleEntity,
      { id: schedule.id },
      { nextDueOn: next },
    );
    await this.generate(actor, schedule.id);
  }

  // ---------------------------------------------------------------- shared

  private async announceDue(checkIds: string[]): Promise<void> {
    const checks = await this.db.findBy(CheckEntity, { id: In(checkIds) });
    for (const check of checks) {
      const plant = await this.db.findOneByOrFail(PlantEntity, {
        id: check.plantId,
      });
      const version = await this.db.findOneByOrFail(CheckTemplateVersionEntity, {
        id: check.templateVersionId,
      });
      const template = await this.db.findOneByOrFail(CheckTemplateEntity, {
        id: version.templateId,
      });
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
          kind: 'check_assigned',
          title: `${checkRef(check.refNo)} is due`,
          body: `${template.name} on ${plant.assetId}${check.dueOn ? `, due ${check.dueOn}` : ''}.`,
          link: `/checks/${check.id}`,
          entityType: 'check',
          entityId: check.id,
        },
      );
    }
  }

  /** Withdraws the schedule's check not yet due; it stays on record. */
  private async withdrawScheduled(
    actor: AuditActor,
    scheduleId: string,
    reason: string,
  ): Promise<void> {
    const waiting = await this.db.findBy(CheckEntity, {
      scheduleId,
      status: 'scheduled',
    });
    for (const check of waiting) {
      await this.db.update(
        CheckEntity,
        { id: check.id },
        {
          status: 'cancelled',
          cancelledAt: this.clock.now(),
          cancelledBy: actor.type === 'user' ? actor.id : null,
          cancelReason: reason,
        },
      );
      await this.audit.record(this.db, {
        scope: 'tenant',
        orgId: this.tenantDb.orgId,
        actor,
        action: 'check.cancelled',
        entityType: 'check',
        entityId: check.id,
        summary: `Cancelled ${checkRef(check.refNo)}: ${reason.toLowerCase()}`,
        metadata: { scheduleId, reason },
      });
    }
  }

  private async publishedTemplate(templateId: string) {
    const template = await this.db.findOneBy(CheckTemplateEntity, {
      id: templateId,
    });
    if (!template) throw fieldError('templateId', 'Template not found.');
    if (template.archivedAt)
      throw fieldError('templateId', `${template.name} is archived.`);
    if (!CHECK_PURPOSES.includes(template.purpose))
      throw fieldError(
        'templateId',
        'Choose an operational, technical or maintenance template.',
      );
    const [version] = await this.db.find(CheckTemplateVersionEntity, {
      where: { templateId, state: 'published' },
      order: { version: 'DESC' },
      take: 1,
    });
    // A Draft can never generate a production check (TMP-AC-01).
    if (!version)
      throw fieldError(
        'templateId',
        `${template.name} has not been published. Publish it first.`,
      );
    return { template, version };
  }

  /**
   * Assignees must be in use, and a named user must be able to see the
   * plant's site, or they could never open the check.
   */
  async checkAssignees(
    input: {
      assigneeUserId: string | null;
      assigneeTeamId: string | null;
      assigneeDisciplineId: string | null;
    },
    plants: PlantEntity[],
  ): Promise<void> {
    if (input.assigneeUserId) {
      const user = await this.db.findOneBy(UserEntity, {
        id: input.assigneeUserId,
      });
      if (!user || user.status !== 'active')
        throw fieldError('assigneeUserId', 'Choose an active user.');
      for (const plant of plants) {
        const reached = await this.people.reached(
          { userId: user.id, teamId: null, disciplineId: null },
          plant.siteId,
        );
        if (!reached.includes(user.id))
          throw fieldError(
            'assigneeUserId',
            `${user.firstName} ${user.lastName} cannot see ${plant.assetId}'s site. Give them the site, or choose someone else.`,
          );
      }
    }
    if (input.assigneeTeamId) {
      const team = await this.db.findOneBy(TeamEntity, {
        id: input.assigneeTeamId,
      });
      if (!team || team.archivedAt)
        throw fieldError('assigneeTeamId', 'Choose an active team.');
    }
    if (input.assigneeDisciplineId) {
      const discipline = await this.db.findOneBy(DisciplineEntity, {
        id: input.assigneeDisciplineId,
      });
      if (!discipline || discipline.archivedAt)
        throw fieldError('assigneeDisciplineId', 'Choose an active discipline.');
    }
  }

  private async loadVisible(
    auth: CustomerAuth,
    id: string,
  ): Promise<CheckScheduleEntity> {
    const schedule = await this.db.findOneBy(CheckScheduleEntity, { id });
    if (!schedule) throw notFound('Schedule');
    const plant = await this.db.findOneBy(PlantEntity, {
      id: schedule.plantId,
    });
    if (!plant || !this.plants.inScope(auth, plant.siteId))
      throw notFound('Schedule');
    return schedule;
  }

  private async plantsById(ids: string[]): Promise<Map<string, PlantEntity>> {
    if (ids.length === 0) return new Map();
    const plants = await this.db.findBy(PlantEntity, {
      id: In([...new Set(ids)]),
    });
    return new Map(plants.map((plant) => [plant.id, plant]));
  }

  private ruleOf(schedule: Partial<CheckScheduleEntity>) {
    return {
      name: schedule.name,
      frequency: schedule.frequency,
      customUnit: schedule.customUnit,
      customCount: schedule.customCount,
      basis: schedule.basis,
      startOn: schedule.startOn,
      requiresApproval: schedule.requiresApproval,
      assigneeUserId: schedule.assigneeUserId,
      assigneeTeamId: schedule.assigneeTeamId,
      assigneeDisciplineId: schedule.assigneeDisciplineId,
    };
  }

  private stateOf(schedule: CheckScheduleEntity): ScheduleState {
    if (schedule.archivedAt) return 'archived';
    if (schedule.pausedAt) return 'paused';
    if (schedule.plantPausedAt) return 'plant_offline';
    return 'active';
  }

  async toSchedules(
    auth: CustomerAuth,
    schedules: CheckScheduleEntity[],
    plants: Map<string, PlantEntity>,
  ): Promise<CheckSchedule[]> {
    if (schedules.length === 0) return [];
    const today = await this.compliance.today();
    const templates = await this.db.findBy(CheckTemplateEntity, {
      id: In([...new Set(schedules.map((s) => s.templateId))]),
    });
    const sites = await this.db.findBy(SiteEntity, {
      id: In([...new Set([...plants.values()].map((p) => p.siteId))]),
    });
    const teams = await this.db.find(TeamEntity);
    const disciplines = await this.db.find(DisciplineEntity);
    const people = await this.people.names(
      schedules.flatMap((s) => [s.createdBy, s.pausedBy, s.assigneeUserId]),
    );
    const scheduleIds = schedules.map((s) => s.id);
    const open = await this.db.findBy(CheckEntity, {
      scheduleId: In(scheduleIds),
      status: In([...WAITING]),
    });
    const completed = (await this.db.query(
      `select schedule_id as "scheduleId", max(coalesce(completed_at, submitted_at)) as at
         from corecheck.checks
        where schedule_id = any($1::uuid[]) and submitted_at is not null
        group by schedule_id`,
      [scheduleIds],
    )) as Array<{ scheduleId: string; at: Date }>;
    const ref = (list: IdName[], id: string | null) => {
      const item = id ? list.find((entry) => entry.id === id) : undefined;
      return item ? { id: item.id, name: item.name } : null;
    };
    const manage = auth.permissions.has('schedules.manage_rules');
    return schedules.map((schedule) => {
      const plant = plants.get(schedule.plantId)!;
      const template = templates.find((t) => t.id === schedule.templateId)!;
      const site = sites.find((s) => s.id === plant.siteId);
      const waiting = open.find((check) => check.scheduleId === schedule.id);
      const state = this.stateOf(schedule);
      const last = completed.find((row) => row.scheduleId === schedule.id);
      return {
        id: schedule.id,
        name: schedule.name,
        template: {
          id: template.id,
          name: template.name,
          purpose: template.purpose,
        },
        plant: {
          id: plant.id,
          assetId: plant.assetId,
          name: plant.name,
          status: plant.status,
          site: { id: plant.siteId, name: site?.name ?? '' },
        },
        frequency: schedule.frequency,
        customUnit: schedule.customUnit,
        customCount: schedule.customCount,
        recurrence: describeRecurrence(schedule),
        basis: schedule.basis,
        startOn: schedule.startOn,
        nextDueOn: schedule.nextDueOn,
        requiresApproval: schedule.requiresApproval,
        assignee: {
          user: schedule.assigneeUserId
            ? {
                id: schedule.assigneeUserId,
                name: people.get(schedule.assigneeUserId) ?? 'Unknown',
              }
            : null,
          team: ref(teams, schedule.assigneeTeamId),
          discipline: ref(disciplines, schedule.assigneeDisciplineId),
        },
        state,
        pauseReason: schedule.pauseReason,
        pausedAt: schedule.pausedAt?.toISOString() ?? null,
        pausedBy: schedule.pausedBy
          ? (people.get(schedule.pausedBy) ?? null)
          : null,
        openCheck: waiting
          ? {
              id: waiting.id,
              ref: checkRef(waiting.refNo),
              status: displayStatus(waiting.status, waiting.dueOn, today),
              dueOn: waiting.dueOn,
            }
          : null,
        lastCompletedAt: last ? new Date(last.at).toISOString() : null,
        createdBy: people.get(schedule.createdBy) ?? 'Unknown',
        createdAt: schedule.createdAt.toISOString(),
        capabilities: {
          edit: manage && state !== 'archived',
          pause: manage && state !== 'archived' && !schedule.pausedAt,
          resume: manage && state !== 'archived' && !!schedule.pausedAt,
          end: manage && state !== 'archived',
        },
      };
    });
  }

  private record(
    actor: AuditActor,
    action: AuditAction,
    entityId: string,
    summary: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(this.db, {
      scope: 'tenant',
      orgId: this.tenantDb.orgId,
      actor,
      action,
      entityType: 'schedule',
      entityId,
      summary,
      metadata,
    });
  }

  private recordOnPlant(
    actor: AuditActor,
    action: AuditAction,
    plant: PlantEntity,
    summary: string,
  ): Promise<void> {
    return this.audit.record(this.db, {
      scope: 'tenant',
      orgId: this.tenantDb.orgId,
      actor,
      action,
      entityType: 'plant',
      entityId: plant.id,
      summary,
    });
  }
}
