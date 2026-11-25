import type supertest from 'supertest';
import type {
  CheckDetail,
  CheckSchedule,
  CheckSummary,
  CheckTemplateDetail,
  DefectDetail,
  NotificationList,
  Paginated,
  PlantDetail,
  PlantReception,
  PlantSaved,
  SaveTemplateDraftInput,
  TemplatePurpose,
} from '@corecheck/shared';
import { addDaysTo, nextAfter } from '../src/checks/recurrence.js';
import { ScheduleSweepService } from '../src/checks/schedule-sweep.service.js';
import {
  type ApiClient,
  createActiveUser,
  createSite,
  createStaffAccount,
  createTeam,
  type OrganisationFixture,
  setUpOrganisation,
  staffSession,
  uid,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

type Agent = ReturnType<typeof supertest.agent>;
type Question = NonNullable<SaveTemplateDraftInput['questions']>[number];
type User = { client: ApiClient; id: string };

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex'),
  Buffer.from('0000000049454e44ae426082', 'hex'),
]);
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

describe('Templates, schedules, checks and Defects (FRD 10–13)', () => {
  let t: TestApp;
  let staff: Agent;
  let org: OrganisationFixture;
  let siteId: string;
  let otherSiteId: string;
  let typeId: string;
  let otherTypeId: string;
  let hireId: string;
  let meterId: string;
  let teamId: string;
  let disciplineId: string;
  let supervisor: User;
  let manager: User;
  let technician: User;
  let operative: User;
  let colleague: User;
  let outsider: User;
  let sweep: ScheduleSweepService;
  let today: string;

  const id = async (url: string, body: object) =>
    ((await org.admin.post(url, body).expect(201)).body as { id: string }).id;

  /** A published template; extra settings go into the draft before publishing. */
  const template = async (
    purpose: TemplatePurpose,
    questions: Question[],
    settings: Partial<SaveTemplateDraftInput> = {},
    approvalMode: 'automatic' | 'manual' = 'automatic',
  ) => {
    const created = (
      await org.admin
        .post('/templates', { name: `${purpose} ${uid()}`, purpose, approvalMode })
        .expect(201)
    ).body as CheckTemplateDetail;
    await org.admin
      .put(`/templates/${created.id}/draft`, { questions, ...settings })
      .expect(200);
    await org.admin.post(`/templates/${created.id}/publish`, {}).expect(200);
    return created.id;
  };

  const dailyQuestions = (): Question[] => [
    { id: 'tyres', text: 'Tyres in good condition', type: 'pass_fail' },
    {
      id: 'tyre-depth',
      text: 'Tread depth',
      type: 'number',
      showIf: { questionId: 'tyres', when: 'fail', values: [] },
    },
    {
      id: 'fuel',
      text: 'Fuel level',
      type: 'single_select',
      options: ['Full', 'Half', 'Empty'],
      failOptions: ['Empty'],
    },
    { id: 'notes', text: 'Notes', type: 'text', mandatory: false },
  ];

  const plant = async (type = typeId, site = siteId) => {
    const created = (
      (
        await org.admin
          .post('/plants', {
            name: `Excavator ${uid()}`,
            plantTypeId: type,
            ownership: 'hired',
            companyId: hireId,
            siteId: site,
          })
          .expect(201)
      ).body as PlantSaved
    ).plant;
    // Reception is covered elsewhere: put the plant straight into service.
    await t.dataSource.query(
      `update corecheck.plants set status = 'approved', approved_at = now() where id = $1`,
      [created.id],
    );
    return created;
  };

  const plantOf = async (plantId: string) =>
    (await org.admin.get(`/plants/${plantId}`).expect(200)).body as PlantDetail;

  const assignCheck = async (
    plantId: string,
    templateId: string,
    assignee: Record<string, string> = { assigneeUserId: operative.id },
    extra: object = {},
  ) =>
    (
      await supervisor.client
        .post('/checks', { plantId, templateId, ...assignee, ...extra })
        .expect(201)
    ).body as CheckDetail;

  const answer = (client: ApiClient, checkId: string, answers: object[], reason?: string) =>
    client.put(`/checks/${checkId}/answers`, { answers, reason });

  const passAll = (client: ApiClient, checkId: string) =>
    answer(client, checkId, [
      { questionId: 'tyres', value: 'pass' },
      { questionId: 'fuel', value: 'Full' },
    ]).expect(200);

  const getCheck = async (client: ApiClient, checkId: string) =>
    (await client.get(`/checks/${checkId}`).expect(200)).body as CheckDetail;

  const schedulesOf = async (plantId: string) =>
    (await org.admin.get(`/schedules?plantId=${plantId}&includeArchived=true`).expect(200))
      .body as CheckSchedule[];

  const runSweep = () => sweep.sweepOrg(org.orgId);

  beforeAll(async () => {
    t = await createTestApp();
    sweep = t.app.get(ScheduleSweepService);
    staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff);
    siteId = await createSite(org.admin);
    otherSiteId = await createSite(org.admin);
    typeId = await id('/config/plant-types', { name: `Excavator ${uid()}` });
    otherTypeId = await id('/config/plant-types', { name: `Crane ${uid()}` });
    hireId = await id('/config/plant-companies', {
      kind: 'hire_company',
      name: `Hire ${uid()}`,
    });
    meterId = await id('/config/meter-types', { name: 'Hours', unit: 'hrs' });
    teamId = await createTeam(org.admin);
    disciplineId = await id('/disciplines', { name: `Electrical ${uid()}` });
    const user = (role: keyof typeof org.roleIds, name: string, extra: object = {}) =>
      createActiveUser(t, org.admin, {
        firstName: name,
        lastName: role,
        roleId: org.roleIds[role],
        siteIds: [siteId],
        ...extra,
      });
    supervisor = await user('supervisor', 'Sue');
    manager = await user('manager', 'Max');
    technician = await user('technician', 'Tom', { disciplineIds: [disciplineId] });
    operative = await user('operative', 'Olga', { teamIds: [teamId] });
    colleague = await user('operative', 'Colin', { teamIds: [teamId] });
    outsider = await createActiveUser(t, org.admin, {
      firstName: 'Otto',
      lastName: 'Elsewhere',
      roleId: org.roleIds.operative,
      siteIds: [otherSiteId],
    });
    const [row] = (await t.dataSource.query(
      `select to_char((now() at time zone 'Europe/London')::date, 'YYYY-MM-DD') as today`,
    )) as [{ today: string }];
    today = row.today;
  });
  afterAll(() => t.close());

  // ------------------------------------------------------------- templates

  describe('check templates (FRD 10)', () => {
    it('supports every purpose and duplicates a template as a new Draft (TMP-001, TMP-007)', async () => {
      const operational = await template('operational', dailyQuestions());
      for (const purpose of ['technical', 'maintenance', 'defect_verification'] as const)
        await org.admin
          .post('/templates', { name: `${purpose} ${uid()}`, purpose })
          .expect(201);
      const copy = (
        await org.admin
          .post(`/templates/${operational}/duplicate`, { name: `Copy ${uid()}` })
          .expect(201)
      ).body as CheckTemplateDetail;
      expect(copy).toMatchObject({
        purpose: 'operational',
        publishedVersion: null,
        hasDraft: true,
        questionCount: 4,
      });
      expect(copy.draft!.questions.map((q) => q.id)).toEqual([
        'tyres',
        'tyre-depth',
        'fuel',
        'notes',
      ]);
      // Only Admin manages templates in the standard roles.
      await manager.client
        .post(`/templates/${operational}/duplicate`, { name: `No ${uid()}` })
        .expect(403);
    });

    it('validates single selection and conditional follow-ups (TMP-009, TMP-010)', async () => {
      const created = (
        await org.admin
          .post('/templates', { name: `Rules ${uid()}`, purpose: 'operational' })
          .expect(201)
      ).body as CheckTemplateDetail;
      const fieldsOf = async (questions: Question[]) =>
        (
          (
            await org.admin
              .put(`/templates/${created.id}/draft`, { questions })
              .expect(400)
          ).body.fieldErrors as Array<{ field: string }>
        ).map((error) => error.field);
      expect(
        await fieldsOf([
          { id: 'a', text: 'Colour', type: 'single_select', options: ['Red'] },
        ]),
      ).toContain('questions.0.options');
      expect(
        await fieldsOf([
          {
            id: 'a',
            text: 'Colour',
            type: 'single_select',
            options: ['Red', 'Blue'],
            failOptions: ['Green'],
          },
        ]),
      ).toContain('questions.0.failOptions');
      // A follow-up must follow an earlier question, never a later one.
      expect(
        await fieldsOf([
          {
            id: 'a',
            text: 'Why',
            type: 'text',
            showIf: { questionId: 'b', when: 'fail', values: [] },
          },
          { id: 'b', text: 'OK?', type: 'pass_fail' },
        ]),
      ).toContain('questions.0.showIf');
    });

    it('never lets a Draft generate a production check (TMP-AC-01)', async () => {
      const draft = (
        await org.admin
          .post('/templates', { name: `Draft ${uid()}`, purpose: 'operational' })
          .expect(201)
      ).body as CheckTemplateDetail;
      await org.admin
        .put(`/templates/${draft.id}/draft`, { questions: dailyQuestions() })
        .expect(200);
      const item = await plant();
      const refused = await supervisor.client
        .post('/checks', {
          plantId: item.id,
          templateId: draft.id,
          assigneeUserId: operative.id,
        })
        .expect(400);
      expect(refused.body.fieldErrors[0].field).toBe('templateId');
      await org.admin
        .post('/schedules', {
          name: 'Never',
          templateId: draft.id,
          plantIds: [item.id],
          frequency: 'daily',
          startOn: today,
          assigneeUserId: operative.id,
        })
        .expect(400);
    });

    it('moves only unstarted checks to a new version and keeps older versions reproducible (TMP-005, TMP-006, TMP-AC-02, TMP-AC-03)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const item = await plant();
      const started = await assignCheck(item.id, templateId);
      const waiting = await assignCheck(item.id, templateId);
      await answer(operative.client, started.id, [{ questionId: 'tyres', value: 'pass' }]).expect(200);

      await org.admin
        .put(`/templates/${templateId}/draft`, {
          questions: [...dailyQuestions(), { id: 'horn', text: 'Horn works', type: 'yes_no' }],
        })
        .expect(200);
      const before = (await org.admin.get(`/templates/${templateId}`).expect(200))
        .body as CheckTemplateDetail;
      // Only the check nobody has started or answered can move.
      expect(before.unstartedChecks).toBe(1);
      const published = (
        await org.admin
          .post(`/templates/${templateId}/publish`, { applyToUnstarted: true })
          .expect(200)
      ).body as CheckTemplateDetail;
      expect(published).toMatchObject({ publishedVersion: 2, unstartedChecks: 0 });

      const moved = await getCheck(operative.client, waiting.id);
      expect(moved.template.version).toBe(2);
      expect(moved.questions.map((q) => q.id)).toContain('horn');
      const kept = await getCheck(operative.client, started.id);
      expect(kept.template.version).toBe(1);
      expect(kept.questions.map((q) => q.id)).not.toContain('horn');
      expect(kept.answers[0]).toMatchObject({ questionId: 'tyres', value: 'pass' });
    });

    it('limits a template to plant types and to eligible people (TMP-008)', async () => {
      const templateId = await template('technical', dailyQuestions(), {
        eligibility: {
          plantTypeIds: [typeId],
          disciplineIds: [disciplineId],
          teamIds: [],
          userIds: [],
          categoryIds: [],
        },
      });
      const crane = await plant(otherTypeId);
      await supervisor.client
        .post('/checks', { plantId: crane.id, templateId, assigneeUserId: technician.id })
        .expect(400);
      const item = await plant();
      const check = await assignCheck(item.id, templateId, { assigneeTeamId: teamId });
      // The operative's team is assigned, but the template is for the discipline.
      const refused = await answer(operative.client, check.id, [
        { questionId: 'tyres', value: 'pass' },
      ]).expect(403);
      expect(refused.body.code).toBe('NOT_ELIGIBLE');
    });
  });

  // ------------------------------------------------------------- schedules

  describe('check schedules (FRD 11)', () => {
    it('lets only Admin create rules, and generates the first check from the start date (SCH-001..003, SCH-AC-01)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const item = await plant();
      const input = {
        name: 'Daily pre-use',
        templateId,
        plantIds: [item.id],
        frequency: 'daily',
        startOn: today,
        assigneeTeamId: teamId,
      };
      await supervisor.client.post('/schedules', input).expect(403);
      const [schedule] = (await org.admin.post('/schedules', input).expect(201))
        .body as CheckSchedule[];
      expect(schedule).toMatchObject({
        state: 'active',
        nextDueOn: today,
        recurrence: 'Daily',
        openCheck: { status: 'due', dueOn: today },
      });
      // The team sees it in their own list.
      const mine = (await colleague.client.get('/checks?view=mine').expect(200))
        .body as Paginated<CheckSummary>;
      expect(mine.items.map((c) => c.id)).toContain(schedule!.openCheck!.id);
    });

    it('resumes schedules in the database exactly as the API calculates intervals', async () => {
      const cases = [
        ['daily', null, null, '2026-03-31'],
        ['weekly', null, null, '2026-12-28'],
        ['monthly', null, null, '2026-01-31'],
        ['quarterly', null, null, '2026-11-30'],
        ['annual', null, null, '2028-02-29'],
        ['custom', 'week', 6, '2026-11-25'],
        ['custom', 'month', 18, '2026-08-31'],
      ] as const;
      for (const [frequency, unit, count, from] of cases) {
        const [row] = (await t.dataSource.query(
          `select to_char(($1::date + corecheck.schedule_interval($2, $3, $4))::date, 'YYYY-MM-DD') as next`,
          [from, frequency, unit, count],
        )) as [{ next: string }];
        expect([frequency, row.next]).toEqual([
          frequency,
          nextAfter(from, { frequency, customUnit: unit, customCount: count }),
        ]);
      }
    });

    it('makes weekly checks visible at the start of their week and Due on the sweep (SCH-006)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const item = await plant();
      const start = addDaysTo(today, 21);
      const [schedule] = (
        await org.admin
          .post('/schedules', {
            name: 'Weekly',
            templateId,
            plantIds: [item.id],
            frequency: 'weekly',
            startOn: start,
            assigneeUserId: operative.id,
          })
          .expect(201)
      ).body as CheckSchedule[];
      const check = await getCheck(org.admin, schedule!.openCheck!.id);
      expect(check.status).toBe('scheduled');
      const monday = new Date(`${check.availableOn}T00:00:00Z`).getUTCDay();
      expect(monday).toBe(1);
      expect(check.availableOn! <= start).toBe(true);
      // Not workable until its week begins.
      await answer(operative.client, check.id, [{ questionId: 'tyres', value: 'pass' }]).expect(409);
      // Its week arrives.
      await t.dataSource.query(
        `update corecheck.checks set available_on = $2 where id = $1`,
        [check.id, today],
      );
      const result = await runSweep();
      expect(result.due).toBeGreaterThanOrEqual(1);
      expect((await getCheck(org.admin, check.id)).status).toBe('due');
    });

    it('calculates the next check from the actual completion date (SCH-009, SCH-AC-01)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const item = await plant();
      const [schedule] = (
        await org.admin
          .post('/schedules', {
            name: 'Weekly from completion',
            templateId,
            plantIds: [item.id],
            frequency: 'weekly',
            startOn: addDaysTo(today, -3),
            assigneeUserId: operative.id,
          })
          .expect(201)
      ).body as CheckSchedule[];
      const first = schedule!.openCheck!;
      expect(first.status).toBe('overdue');
      await passAll(operative.client, first.id);
      await operative.client.post(`/checks/${first.id}/submit`).expect(200);
      const [after] = await schedulesOf(item.id);
      const next = nextAfter(today, { frequency: 'weekly', customUnit: null, customCount: null });
      expect(after).toMatchObject({ nextDueOn: next });
      expect(after!.openCheck).toMatchObject({ dueOn: next });
      expect(after!.lastCompletedAt).not.toBeNull();
      expect((await getCheck(org.admin, first.id)).status).toBe('completed');
    });

    it('pauses while the plant is Offline, keeps history, and resumes from the return-to-service date (SCH-010, SCH-AC-02, SCH-AC-03)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const item = await plant();
      const [schedule] = (
        await org.admin
          .post('/schedules', {
            name: 'Monthly',
            templateId,
            plantIds: [item.id],
            frequency: 'monthly',
            startOn: addDaysTo(today, 40),
            assigneeUserId: operative.id,
          })
          .expect(201)
      ).body as CheckSchedule[];
      const waiting = schedule!.openCheck!;
      await supervisor.client
        .post(`/plants/${item.id}/restrict`, { note: 'Hydraulic leak' })
        .expect(200);
      const [paused] = await schedulesOf(item.id);
      expect(paused).toMatchObject({ state: 'plant_offline', openCheck: null });
      // The withdrawn check is kept, cancelled, with the reason.
      const withdrawn = await getCheck(org.admin, waiting.id);
      expect(withdrawn).toMatchObject({ status: 'cancelled' });
      expect(withdrawn.cancelReason).toMatch(/out of service/);
      expect(await runSweep()).toMatchObject({ generated: 0 });

      await supervisor.client
        .post(`/plants/${item.id}/return-to-service`, { note: 'Repaired' })
        .expect(200);
      const [resumed] = await schedulesOf(item.id);
      const expected = nextAfter(today, {
        frequency: 'monthly',
        customUnit: null,
        customCount: null,
      });
      // One interval after the return-to-service date (start date is later still).
      expect(resumed!.state).toBe('active');
      expect(resumed!.nextDueOn).toBe(
        expected > addDaysTo(today, 40) ? expected : addDaysTo(today, 40),
      );
      await runSweep();
      const [again] = await schedulesOf(item.id);
      expect(again!.openCheck).not.toBeNull();
    });

    it('lets a Supervisor reschedule one check without changing the rule (SCH-004, SCH-005, SCH-AC-04)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const item = await plant();
      const [schedule] = (
        await org.admin
          .post('/schedules', {
            name: 'Quarterly',
            templateId,
            plantIds: [item.id],
            frequency: 'quarterly',
            startOn: addDaysTo(today, 10),
            assigneeUserId: operative.id,
          })
          .expect(201)
      ).body as CheckSchedule[];
      const target = addDaysTo(today, 20);
      const moved = (
        await supervisor.client
          .post(`/checks/${schedule!.openCheck!.id}/reschedule`, {
            dueOn: target,
            reason: 'Plant on another job',
          })
          .expect(200)
      ).body as CheckDetail;
      expect(moved.dueOn).toBe(target);
      const [rule] = await schedulesOf(item.id);
      expect(rule).toMatchObject({ frequency: 'quarterly', startOn: addDaysTo(today, 10) });
      await supervisor.client
        .put(`/schedules/${schedule!.id}`, {
          name: 'Changed',
          frequency: 'daily',
          startOn: today,
          assigneeUserId: operative.id,
        })
        .expect(403);
      // Reassigning is the Supervisor's too (SCH-004).
      const reassigned = (
        await supervisor.client
          .post(`/checks/${schedule!.openCheck!.id}/assign`, { assigneeTeamId: teamId })
          .expect(200)
      ).body as CheckDetail;
      expect(reassigned.assignee.team?.id).toBe(teamId);
    });

    it('marks work Overdue and tells the assignee and those managing overdue work, once (SCH-007, SCH-008)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const item = await plant();
      const check = await assignCheck(item.id, templateId, { assigneeUserId: operative.id }, {
        dueOn: today,
      });
      await t.dataSource.query(`update corecheck.checks set due_on = $2 where id = $1`, [
        check.id,
        addDaysTo(today, -1),
      ]);
      const overdue = (await supervisor.client.get('/checks?view=overdue').expect(200))
        .body as Paginated<CheckSummary>;
      const row = overdue.items.find((c) => c.id === check.id);
      expect(row).toMatchObject({ displayStatus: 'overdue', overdue: true });
      await runSweep();
      await runSweep();
      const count = async (client: ApiClient) =>
        ((await client.get('/notifications').expect(200)).body as NotificationList).items.filter(
          (n) => n.kind === 'check_overdue' && n.link === `/checks/${check.id}`,
        ).length;
      expect(await count(operative.client)).toBe(1);
      expect(await count(supervisor.client)).toBe(1);
      expect(await count(outsider.client)).toBe(0);
    });

    it('pauses and resumes a rule, and creates an approval step only when the schedule requires it (SCH-001, SCH-011)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const item = await plant();
      const [schedule] = (
        await org.admin
          .post('/schedules', {
            name: 'Approved daily',
            templateId,
            plantIds: [item.id],
            frequency: 'custom',
            customUnit: 'day',
            customCount: 2,
            startOn: today,
            requiresApproval: true,
            assigneeUserId: operative.id,
          })
          .expect(201)
      ).body as CheckSchedule[];
      expect(schedule!.recurrence).toBe('Every 2 days');
      const check = schedule!.openCheck!;
      await passAll(operative.client, check.id);
      const submitted = (
        await operative.client.post(`/checks/${check.id}/submit`).expect(200)
      ).body as CheckDetail;
      expect(submitted.status).toBe('submitted');

      const paused = (
        await org.admin
          .post(`/schedules/${schedule!.id}/pause`, { reason: 'Site closed' })
          .expect(200)
      ).body as CheckSchedule;
      expect(paused).toMatchObject({ state: 'paused', pauseReason: 'Site closed', openCheck: null });
      const resumed = (
        await org.admin.post(`/schedules/${schedule!.id}/resume`, {}).expect(200)
      ).body as CheckSchedule;
      expect(resumed.state).toBe('active');
      expect(resumed.openCheck).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------- checks

  describe('checks (FRD 12)', () => {
    it('blocks submission until every asked mandatory question is answered, follow-ups included (CHK-006, CHK-AC-01, TMP-009)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const check = await assignCheck((await plant()).id, templateId);
      const fields = async () =>
        (
          (await operative.client.post(`/checks/${check.id}/submit`).expect(400)).body
            .fieldErrors as Array<{ field: string }>
        ).map((e) => e.field);
      expect(await fields()).toEqual(['answers.tyres', 'answers.fuel']);
      // Failing the tyres asks the follow-up, which is then mandatory.
      await answer(operative.client, check.id, [
        { questionId: 'tyres', value: 'fail' },
        { questionId: 'fuel', value: 'Half' },
      ]).expect(200);
      expect(await fields()).toEqual(['answers.tyre-depth']);
      await answer(operative.client, check.id, [{ questionId: 'tyre-depth', value: 1.5 }]).expect(200);
      await operative.client.post(`/checks/${check.id}/submit`).expect(200);
    });

    it('keeps attribution when two people answer different questions (CHK-003, CHK-004, CHK-AC-02)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const check = await assignCheck((await plant()).id, templateId, { assigneeTeamId: teamId });
      await Promise.all([
        answer(operative.client, check.id, [{ questionId: 'tyres', value: 'pass' }]).expect(200),
        answer(colleague.client, check.id, [{ questionId: 'fuel', value: 'Full' }]).expect(200),
      ]);
      await answer(colleague.client, check.id, [{ questionId: 'notes', value: 'All good' }]).expect(200);
      const detail = await getCheck(supervisor.client, check.id);
      const by = (q: string) => detail.answers.find((a) => a.questionId === q)?.answeredBy;
      expect(by('tyres')).toBe('Olga operative');
      expect(by('fuel')).toBe('Colin operative');
      expect(detail.status).toBe('in_progress');
      expect(detail.contributors).toEqual(
        expect.arrayContaining([
          { name: 'Olga operative', questionIds: ['tyres'] },
          { name: 'Colin operative', questionIds: ['fuel', 'notes'] },
        ]),
      );
      expect(detail.changes.map((c) => c.changedBy)).toEqual([
        expect.any(String),
        expect.any(String),
        'Colin operative',
      ]);
    });

    it('lets the first submission win and refuses the second (CHK-007, CHK-AC-03)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const check = await assignCheck((await plant()).id, templateId, { assigneeTeamId: teamId });
      await passAll(operative.client, check.id);
      const results = await Promise.all([
        operative.client.post(`/checks/${check.id}/submit`),
        colleague.client.post(`/checks/${check.id}/submit`),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);
      const refused = results.find((r) => r.status === 409)!;
      expect(refused.body.code).toBe('ALREADY_SUBMITTED');
      const detail = await getCheck(supervisor.client, check.id);
      expect(detail.submissions).toHaveLength(1);
      // Read-only to contributors afterwards (CHK-008).
      await answer(colleague.client, check.id, [{ questionId: 'notes', value: 'late' }]).expect(409);
    });

    it('refuses work assigned to someone else and hides other sites (CHK-001)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const check = await assignCheck((await plant()).id, templateId, { assigneeUserId: operative.id });
      const refused = await answer(colleague.client, check.id, [
        { questionId: 'tyres', value: 'pass' },
      ]).expect(403);
      expect(refused.body.message).toMatch(/someone else/);
      await outsider.client.get(`/checks/${check.id}`).expect(404);
      // A Supervisor may step in within scope.
      await answer(supervisor.client, check.id, [{ questionId: 'tyres', value: 'pass' }]).expect(200);
    });

    it('reviews, returns, approves, rejects and reopens with reasons (CHK-009, CHK-010)', async () => {
      const templateId = await template('operational', dailyQuestions(), {}, 'manual');
      const check = await assignCheck((await plant()).id, templateId);
      expect(check.requiresReview).toBe(true);
      await passAll(operative.client, check.id);
      await operative.client.post(`/checks/${check.id}/submit`).expect(200);
      await operative.client
        .post(`/checks/${check.id}/review`, { decision: 'approve' })
        .expect(403);
      await supervisor.client
        .post(`/checks/${check.id}/review`, { decision: 'return' })
        .expect(400);
      const returned = (
        await supervisor.client
          .post(`/checks/${check.id}/review`, { decision: 'return', comment: 'Add notes' })
          .expect(200)
      ).body as CheckDetail;
      expect(returned).toMatchObject({ status: 'returned', reviewComment: 'Add notes' });
      await answer(operative.client, check.id, [{ questionId: 'notes', value: 'Clean' }]).expect(200);
      await operative.client.post(`/checks/${check.id}/submit`).expect(200);
      const approved = (
        await supervisor.client
          .post(`/checks/${check.id}/review`, { decision: 'approve' })
          .expect(200)
      ).body as CheckDetail;
      expect(approved.status).toBe('completed');
      expect(approved.submissions).toHaveLength(2);
      await supervisor.client.post(`/checks/${check.id}/reopen`, {}).expect(400);
      const reopened = (
        await supervisor.client
          .post(`/checks/${check.id}/reopen`, { reason: 'Wrong plant' })
          .expect(200)
      ).body as CheckDetail;
      expect(reopened.status).toBe('returned');
      await operative.client.post(`/checks/${check.id}/submit`).expect(200);
      const rejected = (
        await supervisor.client
          .post(`/checks/${check.id}/review`, { decision: 'reject', comment: 'Not done' })
          .expect(200)
      ).body as CheckDetail;
      expect(rejected.status).toBe('rejected');
      expect(rejected.history.map((e) => e.action)).toEqual(
        expect.arrayContaining(['check.returned', 'check.approved', 'check.reopened', 'check.rejected']),
      );
    });

    it('lets a Manager edit a submitted check only with a reason, keeping the original (CHK-010, CHK-AC-04)', async () => {
      const templateId = await template('operational', dailyQuestions());
      const check = await assignCheck((await plant()).id, templateId);
      await passAll(operative.client, check.id);
      await operative.client.post(`/checks/${check.id}/submit`).expect(200);
      await answer(supervisor.client, check.id, [{ questionId: 'fuel', value: 'Half' }], 'typo').expect(409);
      await answer(manager.client, check.id, [{ questionId: 'fuel', value: 'Half' }]).expect(400);
      const edited = (
        await answer(manager.client, check.id, [{ questionId: 'fuel', value: 'Half' }], 'Gauge misread').expect(200)
      ).body as CheckDetail;
      expect(edited.answers.find((a) => a.questionId === 'fuel')).toMatchObject({
        value: 'Half',
        answeredBy: 'Max manager',
      });
      const edit = edited.changes.find((c) => c.afterSubmission)!;
      expect(edit).toMatchObject({
        questionId: 'fuel',
        previousValue: 'Full',
        value: 'Half',
        reason: 'Gauge misread',
        changedBy: 'Max manager',
      });
      // The submission as sent stays as it was.
      expect(edited.submissions[0]!.answers.find((a) => a.questionId === 'fuel')!.value).toBe('Full');
    });

    it('cancels only with a reason and records evidence uploaders (CHK-011, EVD-001, EVD-002)', async () => {
      const templateId = await template('operational', [
        ...dailyQuestions(),
        { id: 'photo', text: 'Photo of the cab', type: 'photo', mandatory: false },
      ]);
      const check = await assignCheck((await plant()).id, templateId);
      const withPhoto = (
        await operative.client
          .post(`/checks/${check.id}/questions/photo/evidence`)
          .attach('file', PNG, { filename: 'cab.png' })
          .expect(201)
      ).body as CheckDetail;
      const withFile = (
        await operative.client
          .post(`/checks/${check.id}/questions/photo/evidence`)
          .attach('file', PDF, { filename: 'report.pdf' })
          .expect(201)
      ).body as CheckDetail;
      expect(withPhoto.evidence[0]).toMatchObject({ uploadedBy: 'Olga operative', questionId: 'photo' });
      expect(withFile.evidence).toHaveLength(2);
      const file = await operative.client
        .get(`/checks/${check.id}/evidence/${withPhoto.evidence[0]!.id}/file`)
        .expect(200);
      expect(file.headers['content-type']).toMatch(/image\/png/);

      await supervisor.client.post(`/checks/${check.id}/cancel`, {}).expect(400);
      await operative.client.post(`/checks/${check.id}/cancel`, { reason: 'x' }).expect(403);
      const cancelled = (
        await supervisor.client
          .post(`/checks/${check.id}/cancel`, { reason: 'Plant left site' })
          .expect(200)
      ).body as CheckDetail;
      expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Plant left site' });
    });

    it('records meter readings, takes plant Offline on a configured failure and exports the record (MTR-003, TMP-009, EVD-003)', async () => {
      const templateId = await template('operational', [
        { id: 'hours', text: 'Hour meter', type: 'meter', meterTypeId: meterId },
        {
          id: 'brakes',
          text: 'Brakes work',
          type: 'pass_fail',
          offlineOnFail: true,
          requireComment: 'on_fail',
        },
      ]);
      const item = await plant();
      const check = await assignCheck(item.id, templateId);
      await answer(operative.client, check.id, [
        { questionId: 'hours', value: 120 },
        { questionId: 'brakes', value: 'fail', comment: 'Spongy pedal' },
      ]).expect(200);
      await operative.client.post(`/checks/${check.id}/submit`).expect(200);
      const after = await plantOf(item.id);
      expect(after.status).toBe('restricted');
      expect(after.statusNote).toMatch(/Brakes work/);
      const meters = (await org.admin.get(`/plants/${item.id}/meters`).expect(200)).body as {
        readings: Array<{ value: number; source: string; check: { ref: string } | null }>;
      };
      expect(meters.readings[0]).toMatchObject({ value: 120, source: 'check', check: { ref: check.ref } });
      const pdf = await operative.client.get(`/checks/${check.id}/export`).expect(200);
      expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
      expect(Buffer.from(pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });
  });

  // --------------------------------------------------------------- defects

  describe('Defects and return to service (FRD 13)', () => {
    const triggerQuestions = (): Question[] => [
      {
        id: 'hyd',
        text: 'Hydraulic hoses intact',
        type: 'pass_fail',
        defectSeverity: 'major',
        offlineOnFail: true,
        requireComment: 'on_fail',
      },
      { id: 'mirror', text: 'Mirrors clean', type: 'pass_fail' },
    ];

    let verificationId: string;

    beforeAll(async () => {
      verificationId = await template(
        'defect_verification',
        [{ id: 'fixed', text: 'Repair holds under pressure', type: 'pass_fail' }],
        { requireCorrectiveAction: true },
        'manual',
      );
    });

    const failedCheck = async () => {
      const templateId = await template('operational', triggerQuestions());
      const item = await plant();
      const check = await assignCheck(item.id, templateId);
      await answer(operative.client, check.id, [
        { questionId: 'hyd', value: 'fail', comment: 'Hose split' },
        { questionId: 'mirror', value: 'fail' },
      ]).expect(200);
      const submitted = (
        await operative.client.post(`/checks/${check.id}/submit`).expect(200)
      ).body as CheckDetail;
      return { item, check: submitted };
    };

    it('raises a Defect only from a failed answer with a trigger, keeping its source (DEF-002, DEF-004, DEF-AC-01, TMP-AC-04)', async () => {
      const { item, check } = await failedCheck();
      expect(check.defectsRaised).toHaveLength(1);
      const defect = (await supervisor.client.get(`/defects/${check.defectsRaised[0]!.id}`).expect(200))
        .body as DefectDetail;
      expect(defect).toMatchObject({
        severity: 'major',
        status: 'open',
        questionText: 'Hydraulic hoses intact',
        answer: 'fail',
        answerComment: 'Hose split',
        raisedBy: 'Olga operative',
        restrictsPlant: true,
        source: { kind: 'check', id: check.id, ref: check.ref },
        verification: 'not_started',
      });
      // Mirrors failed too, but have no defect trigger.
      const all = (await supervisor.client.get(`/defects?plantId=${item.id}`).expect(200))
        .body as Paginated<{ questionText: string }>;
      expect(all.items.map((d) => d.questionText)).toEqual(['Hydraulic hoses intact']);
      // Nobody can raise one by hand (DEF-003): there is no such route.
      await org.admin.post('/defects', { plantId: item.id }).expect(404);
    });

    it('raises Defects from reception answers too', async () => {
      const templateId = await template('reception', triggerQuestions());
      const created = (
        (
          await org.admin
            .post('/plants', {
              name: `Reception ${uid()}`,
              plantTypeId: typeId,
              ownership: 'hired',
              companyId: hireId,
              siteId,
            })
            .expect(201)
        ).body as PlantSaved
      ).plant;
      const reception = (
        (await supervisor.client.post(`/plants/${created.id}/reception`, { templateId }).expect(201))
          .body as PlantReception
      ).current!;
      await operative.client
        .put(`/receptions/${reception.id}/answers`, {
          answers: [
            { questionId: 'hyd', value: 'fail', comment: 'Leaking' },
            { questionId: 'mirror', value: 'pass' },
          ],
        })
        .expect(200);
      await operative.client.post(`/receptions/${reception.id}/submit`).expect(200);
      const defects = (await supervisor.client.get(`/defects?plantId=${created.id}`).expect(200))
        .body as Paginated<{ source: { kind: string } }>;
      expect(defects.items).toHaveLength(1);
      expect(defects.items[0]!.source.kind).toBe('reception');
    });

    it('takes a Defect through work, verification under separation of duties, and closure without returning plant to service (DFW-001..011, DEF-AC-02..04)', async () => {
      const { item, check } = await failedCheck();
      const defectId = check.defectsRaised[0]!.id;
      const url = `/defects/${defectId}`;

      // Technicians work only on Defects assigned to them.
      await technician.client.post(`${url}/start`).expect(403);
      await technician.client.post(`${url}/assign`, { assigneeUserId: technician.id }).expect(403);
      await supervisor.client.post(`${url}/assign`, { assigneeUserId: technician.id }).expect(200);
      await technician.client.post(`${url}/start`).expect(200);

      // A Defect cannot close before its verification (DEF-AC-02).
      const early = await technician.client.post(`${url}/close`, {}).expect(409);
      expect(early.body.code).toBe('VERIFICATION_REQUIRED');

      // The template makes corrective action mandatory (DFW-003).
      await technician.client
        .post(`${url}/verification`, { templateId: verificationId })
        .expect(400);
      await technician.client
        .post(`${url}/work`, { correctiveAction: 'Replaced hose', repairNotes: 'OEM part' })
        .expect(200);
      await technician.client
        .post(`${url}/evidence`)
        .attach('file', PNG, { filename: 'new-hose.png' })
        .expect(201);
      const started = (
        await technician.client
          .post(`${url}/verification`, { templateId: verificationId })
          .expect(200)
      ).body as DefectDetail;
      const verification = started.verificationCheck!;
      expect(started.verification).toBe('in_progress');
      await answer(technician.client, verification.id, [{ questionId: 'fixed', value: 'pass' }]).expect(200);
      await technician.client.post(`/checks/${verification.id}/submit`).expect(200);
      expect(
        ((await technician.client.get(url).expect(200)).body as DefectDetail).verification,
      ).toBe('awaiting_approval');
      await technician.client.post(`${url}/close`, {}).expect(409);

      // The Technician cannot approve verification at all; a Supervisor can.
      await technician.client
        .post(`/checks/${verification.id}/review`, { decision: 'approve' })
        .expect(403);
      await supervisor.client
        .post(`/checks/${verification.id}/review`, { decision: 'approve' })
        .expect(200);

      // The plant stays out of service while the Defect that took it there is open.
      const blocked = await supervisor.client
        .post(`/plants/${item.id}/return-to-service`, { note: 'Done' })
        .expect(409);
      expect(blocked.body.code).toBe('DEFECTS_OPEN');

      const closed = (await technician.client.post(`${url}/close`, { note: 'Fixed' }).expect(200))
        .body as DefectDetail;
      expect(closed.status).toBe('closed');
      // Closing does not return plant to service (DEF-AC-04).
      expect((await plantOf(item.id)).status).toBe('restricted');
      // Nor can a Technician (DFW-012).
      await technician.client
        .post(`/plants/${item.id}/return-to-service`, { note: 'Done' })
        .expect(403);
      await supervisor.client
        .post(`/plants/${item.id}/return-to-service`, { note: 'Verified repair' })
        .expect(200);
      expect((await plantOf(item.id)).status).toBe('approved');
      expect(closed.history.map((e) => e.action)).toEqual(
        expect.arrayContaining([
          'defect.raised',
          'defect.assigned',
          'defect.started',
          'defect.work_recorded',
          'defect.evidence_added',
          'defect.verification_started',
          'defect.verification_approved',
          'defect.closed',
        ]),
      );
    });

    it('stops people approving their own verification, allows an audited override and tells Managers when nobody else can approve (DFW-006..009, DEF-AC-03, DEF-AC-05)', async () => {
      const { item, check } = await failedCheck();
      const defectId = check.defectsRaised[0]!.id;
      const url = `/defects/${defectId}`;
      // The Supervisor does the work themselves.
      await supervisor.client.post(`${url}/start`).expect(200);
      await supervisor.client.post(`${url}/work`, { correctiveAction: 'Clamp fitted' }).expect(200);
      const started = (
        await supervisor.client.post(`${url}/verification`, { templateId: verificationId }).expect(200)
      ).body as DefectDetail;
      const checkId = started.verificationCheck!.id;
      await answer(supervisor.client, checkId, [{ questionId: 'fixed', value: 'pass' }]).expect(200);
      await supervisor.client.post(`/checks/${checkId}/submit`).expect(200);

      const own = await supervisor.client
        .post(`/checks/${checkId}/review`, { decision: 'approve' })
        .expect(409);
      expect(own.body.code).toBe('SEPARATION_REQUIRED');
      expect((await getCheck(supervisor.client, checkId)).reviewBlock).toMatch(/separation/);
      await supervisor.client
        .post(`/checks/${checkId}/review`, { decision: 'approve', override: true, comment: 'Alone on site' })
        .expect(403);

      // A Manager who took no part can approve it.
      const managerCheck = await getCheck(manager.client, checkId);
      expect(managerCheck.capabilities).toMatchObject({ review: true, override: false });
      const approved = (
        await manager.client
          .post(`/checks/${checkId}/review`, { decision: 'approve' })
          .expect(200)
      ).body as CheckDetail;
      expect(approved.status).toBe('completed');
      expect((await plantOf(item.id)).status).toBe('restricted');
    });

    it('records an override of separation of duties with the original failure kept (DFW-009, DEF-AC-05)', async () => {
      const { check } = await failedCheck();
      const defectId = check.defectsRaised[0]!.id;
      const url = `/defects/${defectId}`;
      await manager.client.post(`${url}/start`).expect(200);
      await manager.client.post(`${url}/work`, { correctiveAction: 'Hose replaced' }).expect(200);
      const started = (
        await manager.client.post(`${url}/verification`, { templateId: verificationId }).expect(200)
      ).body as DefectDetail;
      const checkId = started.verificationCheck!.id;
      await answer(manager.client, checkId, [{ questionId: 'fixed', value: 'pass' }]).expect(200);
      await manager.client.post(`/checks/${checkId}/submit`).expect(200);
      const detail = await getCheck(manager.client, checkId);
      expect(detail.capabilities).toMatchObject({ review: false, override: true });
      await manager.client
        .post(`/checks/${checkId}/review`, { decision: 'approve', override: true })
        .expect(400);
      const approved = (
        await manager.client
          .post(`/checks/${checkId}/review`, {
            decision: 'approve',
            override: true,
            comment: 'Night shift, no second approver',
          })
          .expect(200)
      ).body as CheckDetail;
      expect(approved.reviewOverrideReason).toBe('Night shift, no second approver');
      const defect = (await manager.client.get(url).expect(200)).body as DefectDetail;
      expect(defect.history.map((e) => e.action)).toEqual(
        expect.arrayContaining(['defect.raised', 'defect.verification_override']),
      );
      expect(defect).toMatchObject({ answer: 'fail', answerComment: 'Hose split' });
    });

    it('waits and tells Managers and Admins when no separate approver exists (DFW-008)', async () => {
      // A site where the only verifier-approver is the one doing the work.
      const lonelySite = await createSite(org.admin);
      const lonely = await createActiveUser(t, org.admin, {
        firstName: 'Lone',
        lastName: 'Supervisor',
        roleId: org.roleIds.supervisor,
        siteIds: [lonelySite],
      });
      const remoteManager = await createActiveUser(t, org.admin, {
        firstName: 'Remote',
        lastName: 'Manager',
        roleId: org.roleIds.manager,
        siteIds: [lonelySite],
      });
      const templateId = await template('operational', triggerQuestions());
      const item = await plant(typeId, lonelySite);
      const check = (
        await lonely.client
          .post('/checks', { plantId: item.id, templateId, assigneeUserId: lonely.id })
          .expect(201)
      ).body as CheckDetail;
      await answer(lonely.client, check.id, [
        { questionId: 'hyd', value: 'fail', comment: 'Burst' },
        { questionId: 'mirror', value: 'pass' },
      ]).expect(200);
      const submitted = (await lonely.client.post(`/checks/${check.id}/submit`).expect(200))
        .body as CheckDetail;
      const url = `/defects/${submitted.defectsRaised[0]!.id}`;
      await lonely.client.post(`${url}/start`).expect(200);
      await lonely.client.post(`${url}/work`, { correctiveAction: 'Hose' }).expect(200);
      const started = (
        await lonely.client.post(`${url}/verification`, { templateId: verificationId }).expect(200)
      ).body as DefectDetail;
      // The Manager and the Admin take part too, so nobody separate is left.
      await answer(remoteManager.client, started.verificationCheck!.id, [
        { questionId: 'fixed', value: 'pass' },
      ]).expect(200);
      await answer(org.admin, started.verificationCheck!.id, [
        { questionId: 'fixed', value: 'pass', comment: 'Pressure tested' },
      ]).expect(200);
      await lonely.client.post(`/checks/${started.verificationCheck!.id}/submit`).expect(200);
      const told = (
        (await remoteManager.client.get('/notifications').expect(200)).body as NotificationList
      ).items.filter((n) => n.kind === 'verification_no_approver');
      expect(told).toHaveLength(1);
      // The Defect waits and the plant stays out of service.
      const waiting = (await lonely.client.get(url).expect(200)).body as DefectDetail;
      expect(waiting.verification).toBe('awaiting_approval');
      expect(waiting.history.map((e) => e.action)).toContain('defect.no_approver');
      expect((await plantOf(item.id)).status).toBe('restricted');
    });

    it('lets only Managers and Admins reopen a closed Defect, which then needs verifying again (DEF-006, Appendix C)', async () => {
      const { check } = await failedCheck();
      const url = `/defects/${check.defectsRaised[0]!.id}`;
      await supervisor.client.post(`${url}/start`).expect(200);
      await supervisor.client.post(`${url}/work`, { correctiveAction: 'Fixed' }).expect(200);
      const started = (
        await supervisor.client.post(`${url}/verification`, { templateId: verificationId }).expect(200)
      ).body as DefectDetail;
      const checkId = started.verificationCheck!.id;
      await answer(supervisor.client, checkId, [{ questionId: 'fixed', value: 'pass' }]).expect(200);
      await supervisor.client.post(`/checks/${checkId}/submit`).expect(200);
      await manager.client.post(`/checks/${checkId}/review`, { decision: 'approve' }).expect(200);
      await supervisor.client.post(`${url}/close`, {}).expect(200);

      await supervisor.client.post(`${url}/reopen`, { reason: 'Leaking again' }).expect(403);
      const reopened = (
        await manager.client.post(`${url}/reopen`, { reason: 'Leaking again' }).expect(200)
      ).body as DefectDetail;
      expect(reopened).toMatchObject({
        status: 'open',
        verification: 'not_started',
        reopenReason: 'Leaking again',
      });
      // The old verification stays on record but no longer counts.
      expect((await getCheck(manager.client, checkId)).status).toBe('completed');
    });

    it('lets a Manager return plant to service despite an open Defect, with a reason (DFW-009)', async () => {
      const { item } = await failedCheck();
      await supervisor.client
        .post(`/plants/${item.id}/return-to-service`, { note: 'Need it', overrideDefects: true })
        .expect(403);
      await manager.client
        .post(`/plants/${item.id}/return-to-service`, { overrideDefects: true })
        .expect(400);
      await manager.client
        .post(`/plants/${item.id}/return-to-service`, {
          note: 'Hose isolated, cleared by engineer',
          overrideDefects: true,
        })
        .expect(200);
      const history = (
        (await org.admin.get(`/plants/${item.id}/history`).expect(200)).body as {
          items: Array<{ action: string }>;
        }
      ).items.map((e) => e.action);
      expect(history).toEqual(
        expect.arrayContaining(['defect.raised', 'plant.restricted', 'plant.defect_override']),
      );
    });
  });
});
