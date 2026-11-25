import type {
  CheckDetail,
  CheckSchedule,
  CheckTemplateDetail,
  DefectDetail,
  PlantSaved,
} from '@corecheck/shared';
import { enterTenantRole } from '../src/database/db-context.js';
import {
  createSite,
  createStaffAccount,
  type OrganisationFixture,
  setUpOrganisation,
  staffSession,
  uid,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex'),
  Buffer.from('0000000049454e44ae426082', 'hex'),
]);

/** Milestone 3 records and files stay inside their organisation (TEN-002). */
describe('Check, schedule and Defect isolation (TEN-002)', () => {
  let t: TestApp;
  let a: OrganisationFixture;
  let b: OrganisationFixture;
  let schedule: CheckSchedule;
  let check: CheckDetail;
  let defect: DefectDetail;
  let importId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const staff = await staffSession(t, await createStaffAccount(t));
    [a, b] = [
      await setUpOrganisation(t, staff),
      await setUpOrganisation(t, staff),
    ];
    const id = async (url: string, body: object) =>
      ((await b.admin.post(url, body).expect(201)).body as { id: string }).id;
    const siteId = await createSite(b.admin);
    const typeId = await id('/config/plant-types', { name: 'Dumper' });
    const companyId = await id('/config/plant-companies', {
      kind: 'hire_company',
      name: 'Dump Hire',
    });
    const plantId = (
      (
        await b.admin
          .post('/plants', {
            name: 'B dumper',
            plantTypeId: typeId,
            ownership: 'hired',
            companyId,
            siteId,
          })
          .expect(201)
      ).body as PlantSaved
    ).plant.id;
    await t.dataSource.query(
      `update corecheck.plants set status = 'approved', approved_at = now() where id = $1`,
      [plantId],
    );
    const template = (
      await b.admin
        .post('/templates', { name: `Daily ${uid()}`, purpose: 'operational' })
        .expect(201)
    ).body as CheckTemplateDetail;
    await b.admin
      .put(`/templates/${template.id}/draft`, {
        questions: [
          { id: 'q', text: 'Brakes', type: 'pass_fail', defectSeverity: 'minor' },
          { id: 'p', text: 'Photo', type: 'photo', mandatory: false },
        ],
      })
      .expect(200);
    await b.admin.post(`/templates/${template.id}/publish`, {}).expect(200);
    const me = (await b.admin.get('/auth/me').expect(200)).body as {
      user: { id: string };
    };
    [schedule] = (
      await b.admin
        .post('/schedules', {
          name: 'Daily',
          templateId: template.id,
          plantIds: [plantId],
          frequency: 'daily',
          startOn: new Date().toISOString().slice(0, 10),
          assigneeUserId: me.user.id,
        })
        .expect(201)
    ).body as CheckSchedule[];
    const checkId = schedule.openCheck!.id;
    await b.admin
      .put(`/checks/${checkId}/answers`, {
        answers: [{ questionId: 'q', value: 'fail' }],
      })
      .expect(200);
    await b.admin
      .post(`/checks/${checkId}/questions/p/evidence`)
      .attach('file', PNG, { filename: 'p.png' })
      .expect(201);
    check = (await b.admin.post(`/checks/${checkId}/submit`).expect(200))
      .body as CheckDetail;
    const defectId = check.defectsRaised[0]!.id;
    await b.admin.post(`/defects/${defectId}/start`).expect(200);
    defect = (
      await b.admin
        .post(`/defects/${defectId}/evidence`)
        .attach('file', PNG, { filename: 'fix.png' })
        .expect(201)
    ).body as DefectDetail;
    importId = (
      (
        await b.admin
          .post('/template-imports')
          .attach(
            'file',
            Buffer.from(
              ['Template Name,Purpose,Question,Answer Type', 'B import,Operational,Q,Text'].join('\n'),
            ),
            { filename: 't.csv', contentType: 'text/csv' },
          )
          .expect(201)
      ).body as { id: string }
    ).id;
  });
  afterAll(() => t.close());

  it('answers "not found" to another organisation for every check, schedule and Defect record', async () => {
    for (const path of [
      `/schedules/${schedule.id}`,
      `/checks/${check.id}`,
      `/checks/${check.id}/export`,
      `/checks/${check.id}/evidence/${check.evidence[0]!.id}/file`,
      `/defects/${defect.id}`,
      `/defects/${defect.id}/evidence/${defect.evidence[0]!.id}/file`,
      `/template-imports/${importId}`,
      `/template-imports/${importId}/report`,
    ])
      await a.admin.get(path).expect(404);
    await a.admin
      .post(`/checks/${check.id}/review`, { decision: 'approve' })
      .expect(404);
    await a.admin.post(`/schedules/${schedule.id}/end`).expect(404);
    await a.admin.post(`/template-imports/${importId}/commit`).expect(404);
    await a.admin
      .post(`/defects/${defect.id}/reopen`, { reason: 'probe' })
      .expect(404);
  });

  it('shows another organisation nothing in the lists or counts', async () => {
    expect((await a.admin.get('/checks?view=all').expect(200)).body).toMatchObject({
      items: [],
      total: 0,
    });
    expect((await a.admin.get('/defects').expect(200)).body).toMatchObject({
      items: [],
      total: 0,
    });
    expect((await a.admin.get('/schedules').expect(200)).body).toEqual([]);
    expect((await a.admin.get('/template-imports').expect(200)).body).toEqual([]);
    const dash = (await a.admin.get('/dashboard').expect(200)).body as {
      recentlyCompleted: unknown[];
      statusChanges: unknown[];
    };
    expect(dash.recentlyCompleted).toEqual([]);
    expect(dash.statusChanges).toEqual([]);
    expect((await a.admin.get('/notifications').expect(200)).body).toMatchObject({
      unread: 0,
    });
    expect((await a.admin.get('/work/summary').expect(200)).body).toEqual({
      checks: { mine: 0, due: 0, overdue: 0, inProgress: 0, awaitingReview: 0 },
      defects: { open: 0, inProgress: 0, critical: 0, assignedToMe: 0 },
    });
  });

  it('hides every Milestone 3 table from another organisation inside the database', async () => {
    const tables = [
      'check_schedules',
      'checks',
      'check_answers',
      'check_answer_changes',
      'check_evidence',
      'check_submissions',
      'defects',
      'defect_evidence',
      'notifications',
      'template_imports',
      'template_import_rows',
    ];
    await t.dataSource.transaction(async (manager) => {
      await enterTenantRole(
        manager,
        a.orgId,
        '00000000-0000-0000-0000-000000000000',
      );
      for (const table of tables) {
        const [{ visible }] = (await manager.query(
          `select count(*)::int as visible from corecheck.${table} where org_id = $1`,
          [b.orgId],
        )) as [{ visible: number }];
        expect([table, visible]).toEqual([table, 0]);
      }
    });
    // ...and the rows do exist for their own organisation.
    const [{ own }] = (await t.dataSource.query(
      `select count(*)::int as own from corecheck.defects where org_id = $1`,
      [b.orgId],
    )) as [{ own: number }];
    expect(own).toBe(1);
  });
});
