import type {
  CheckTemplateDetail,
  TemplateImportDetail,
} from '@corecheck/shared';
import {
  createActiveUser,
  createSite,
  createStaffAccount,
  type OrganisationFixture,
  setUpOrganisation,
  staffSession,
  uid,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const HEADER =
  'Template Name,Purpose,Approval,Applicable Plant Types,Eligible Disciplines,Question,Answer Type,Mandatory,Fail Answer,Choices,Failing Choices,Lowest Allowed,Highest Allowed,Meter Type,Comment,Photo,Fail Takes Plant Offline,Defect Severity,Follow-up Of Question,Asked When';

const csv = (rows: string[][]) =>
  Buffer.from(
    [HEADER, ...rows.map((row) => row.map((cell) => (cell.includes(',') ? `"${cell}"` : cell)).join(','))].join('\n'),
  );

/** 20 cells for one question row. */
const row = (values: Partial<Record<number, string>>) =>
  Array.from({ length: 20 }, (_, index) => values[index] ?? '');

describe('Check template import (FRD 19.4)', () => {
  let t: TestApp;
  let org: OrganisationFixture;
  let typeName: string;
  let disciplineName: string;
  let existing: string;

  const upload = async (body: Buffer, name = 'templates.csv') =>
    (
      await org.admin
        .post('/template-imports')
        .attach('file', body, { filename: name, contentType: 'text/csv' })
        .expect(201)
    ).body as TemplateImportDetail;

  beforeAll(async () => {
    t = await createTestApp();
    const staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff);
    typeName = `Excavator ${uid()}`;
    disciplineName = `Mechanical ${uid()}`;
    await org.admin.post('/config/plant-types', { name: typeName }).expect(201);
    await org.admin.post('/disciplines', { name: disciplineName }).expect(201);
    await org.admin
      .post('/config/meter-types', { name: 'Hours', unit: 'hrs' })
      .expect(201);
    existing = `Existing ${uid()}`;
    await org.admin
      .post('/templates', { name: existing, purpose: 'operational' })
      .expect(201);
  });
  afterAll(() => t.close());

  it('previews, corrects in the app and creates only Drafts (IMP-004, IMP-005, ITM-001, ITM-002)', async () => {
    const daily = `Daily ${uid()}`;
    const lifting = `Lifting ${uid()}`;
    const preview = await upload(
      csv([
        row({ 0: daily, 1: 'Operational', 2: 'Automatic', 3: typeName, 4: disciplineName, 5: 'Hoses intact', 6: 'Pass / fail', 14: 'Required on a fail', 16: 'Yes', 17: 'Major' }),
        row({ 0: daily, 5: 'Where is the leak?', 6: 'Text', 18: '1', 19: 'Fails' }),
        row({ 0: daily, 5: 'Fuel', 6: 'Single selection', 9: 'Full; Half; Low', 10: 'low' }),
        row({ 0: daily, 5: 'Hours', 6: 'Meter reading', 13: 'hours' }),
        row({ 0: lifting, 1: 'Technical', 5: 'Hook latch', 6: 'Dial', 17: 'Huge' }),
        row({ 0: lifting, 5: 'Why', 6: 'Text', 18: '3', 19: 'Fails' }),
        row({ 0: existing, 1: 'Operational', 5: 'Anything', 6: 'Text' }),
      ]),
    );
    expect(preview.templates).toBe(3);
    const group = (name: string) => preview.groups.find((g) => g.name === name)!;
    expect(group(daily)).toMatchObject({ status: 'valid', questions: 4 });
    expect(group(lifting).status).toBe('invalid');
    const problems = (rowNumber: number) =>
      preview.rows.find((r) => r.rowNumber === rowNumber)!.problems.join(' ');
    expect(problems(6)).toMatch(/Answer Type "Dial"/);
    expect(problems(6)).toMatch(/Defect Severity/);
    expect(problems(7)).toMatch(/earlier question/);
    expect(problems(8)).toMatch(/already exists/);

    // Correct the lifting rows in the app, without uploading again.
    const [hook, why] = preview.rows.filter((r) => r.data.template === lifting);
    await org.admin
      .patch(`/template-imports/${preview.id}/rows/${hook!.id}`, {
        data: { ...hook!.data, type: 'Pass / fail', severity: 'Critical', offline: 'Yes' },
      })
      .expect(200);
    const fixed = (
      await org.admin
        .patch(`/template-imports/${preview.id}/rows/${why!.id}`, {
          data: { ...why!.data, followUpOf: '1' },
        })
        .expect(200)
    ).body as TemplateImportDetail;
    expect(fixed.groups.find((g) => g.name === lifting)!.status).toBe('valid');

    // The error report lists what still needs correcting.
    const report = await org.admin
      .get(`/template-imports/${preview.id}/report`)
      .expect(200);
    expect(report.text).toMatch(/already exists/);

    const committed = (
      await org.admin.post(`/template-imports/${preview.id}/commit`).expect(200)
    ).body as TemplateImportDetail;
    expect(committed.imported).toBe(2);
    const created = committed.groups.find((g) => g.name === daily)!.template!;
    const detail = (await org.admin.get(`/templates/${created.id}`).expect(200))
      .body as CheckTemplateDetail;
    // Drafts only: Admin reviews and publishes them (ITM-001).
    expect(detail).toMatchObject({
      purpose: 'operational',
      publishedVersion: null,
      hasDraft: true,
    });
    const questions = detail.draft!.questions;
    expect(questions[0]).toMatchObject({
      type: 'pass_fail',
      requireComment: 'on_fail',
      offlineOnFail: true,
      defectSeverity: 'major',
    });
    expect(questions[1]!.showIf).toEqual({ questionId: 'q1', when: 'fail', values: [] });
    expect(questions[2]).toMatchObject({ options: ['Full', 'Half', 'Low'], failOptions: ['Low'] });
    expect(questions[3]!.meterTypeId).not.toBeNull();
    expect(detail.draft!.eligibility.plantTypeIds).toHaveLength(1);
    expect(detail.draft!.eligibility.disciplineIds).toHaveLength(1);

    // Committing again creates nothing more.
    const again = (
      await org.admin.post(`/template-imports/${preview.id}/commit`).expect(200)
    ).body as TemplateImportDetail;
    expect(again.imported).toBe(2);
  });

  it('refuses files without the required columns, and people who may not manage templates', async () => {
    const bad = await org.admin
      .post('/template-imports')
      .attach('file', Buffer.from('Name,Question\nx,y\n'), {
        filename: 't.csv',
        contentType: 'text/csv',
      })
      .expect(400);
    expect(bad.body.fieldErrors[0].message).toMatch(/Template Name/);
    const siteId = await createSite(org.admin);
    const manager = await createActiveUser(t, org.admin, {
      firstName: 'Imp',
      lastName: 'Manager',
      roleId: org.roleIds.manager,
      siteIds: [siteId],
    });
    await manager.client.get('/template-imports').expect(403);
    await manager.client.get('/template-imports/template').expect(403);
  });

  it('gives an Excel template with the accepted values', async () => {
    const file = await org.admin.get('/template-imports/template').expect(200);
    expect(file.headers['content-type']).toMatch(/spreadsheetml/);
  });
});
