import type {
  AuditEvent,
  Paginated,
  PlantImportDetail,
  PlantImportSummary,
  PlantSaved,
} from '@corecheck/shared';
import type { ApiClient } from './support/fixtures.js';
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
  'Equipment Name,Plant Type,Ownership Type,Owner/Hire Company,Site,Area,System Asset ID,Plant Number,Serial Number';

describe('Plant import (FRD 19)', () => {
  let t: TestApp;
  let staff: Awaited<ReturnType<typeof staffSession>>;
  let org: OrganisationFixture;
  let siteId: string;
  let siteName: string;
  let typeId: string;
  let hireId: string;

  const upload = (agent: ApiClient, csv: string, filename = 'plant.csv') =>
    agent
      .post('/plant-imports')
      .attach('file', Buffer.from(csv), { filename, contentType: 'text/csv' });

  const row = (name: string, extra = ',,,') =>
    `${name},Crane,Hired,Crane Hire,${siteName},${extra}`;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff);
    siteName = `Site ${uid()}`;
    siteId = await createSite(org.admin, siteName);
    const id = async (url: string, body: object) =>
      ((await org.admin.post(url, body).expect(201)).body as { id: string }).id;
    typeId = await id('/config/plant-types', { name: 'Crane' });
    hireId = await id('/config/plant-companies', {
      kind: 'hire_company',
      name: 'Crane Hire',
    });
  });
  afterAll(() => t.close());

  it('offers a template with the allowed values (IMP-002)', async () => {
    const response = await org.admin
      .get('/plant-imports/template')
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((response.body as Buffer).length).toBeGreaterThan(1000);
    expect(response.headers['x-filename']).toBe('plant-import-template.xlsx');
  });

  it('previews rows, imports the ready ones and keeps the rest for correction (IMP-003 to IMP-006)', async () => {
    const good = `Good ${uid()}`;
    const fixable = `Fixable ${uid()}`;
    const csv = [
      HEADER,
      row(good),
      `${fixable},Nope,Hired,Crane Hire,${siteName},,,,`,
    ].join('\n');
    const preview = (await upload(org.admin, csv).expect(201))
      .body as PlantImportDetail;
    expect(preview.rows.map((r) => [r.rowNumber, r.status])).toEqual([
      [2, 'valid'],
      [3, 'invalid'],
    ]);
    expect(preview.rows[1]!.problems).toEqual([
      'Plant type "Nope" was not found.',
    ]);
    // Nothing is created by uploading.
    const before = (await org.admin.get(`/plants?search=${good}`).expect(200))
      .body as Paginated<unknown>;
    expect(before.total).toBe(0);

    const first = (
      await org.admin.post(`/plant-imports/${preview.id}/commit`).expect(200)
    ).body as PlantImportDetail;
    expect(first.counts).toMatchObject({ imported: 1, invalid: 1 });
    expect(first.rows[0]!.plant?.name).toBe(good);

    const report = await org.admin
      .get(`/plant-imports/${preview.id}/report`)
      .expect(200);
    expect(report.text).toContain('Plant type ""Nope"" was not found.');
    expect(report.text).not.toContain(good);

    const invalid = first.rows[1]!;
    const corrected = (
      await org.admin
        .patch(`/plant-imports/${preview.id}/rows/${invalid.id}`, {
          data: { ...invalid.data, plantType: 'crane' },
        })
        .expect(200)
    ).body as PlantImportDetail;
    expect(corrected.rows[1]).toMatchObject({ status: 'valid', problems: [] });

    const second = (
      await org.admin.post(`/plant-imports/${preview.id}/commit`).expect(200)
    ).body as PlantImportDetail;
    expect(second.counts).toMatchObject({ imported: 2, invalid: 0 });

    const imports = (await org.admin.get('/plant-imports').expect(200))
      .body as PlantImportSummary[];
    expect(imports.find((item) => item.id === preview.id)).toMatchObject({
      fileName: 'plant.csv',
      createdBy: expect.any(String),
    });
    const audit = (
      await org.admin.get('/audit-events?category=plant').expect(200)
    ).body as Paginated<AuditEvent>;
    expect(audit.items.some((e) => e.action === 'plant.imported')).toBe(true);
  });

  it('rejects an Asset ID that exists or repeats in the file (IPL-004)', async () => {
    const plant = (
      (
        await org.admin
          .post('/plants', {
            name: `Existing ${uid()}`,
            plantTypeId: typeId,
            ownership: 'hired',
            companyId: hireId,
            siteId,
          })
          .expect(201)
      ).body as PlantSaved
    ).plant;
    const fresh = `ZZ-${uid()}`;
    const csv = [
      HEADER,
      `Taken,Crane,Hired,Crane Hire,${siteName},,${plant.assetId},,`,
      `First,Crane,Hired,Crane Hire,${siteName},,${fresh},,`,
      `Second,Crane,Hired,Crane Hire,${siteName},,${fresh},,`,
    ].join('\n');
    const preview = (await upload(org.admin, csv).expect(201))
      .body as PlantImportDetail;
    expect(preview.rows.map((r) => r.status)).toEqual([
      'invalid',
      'valid',
      'invalid',
    ]);
    expect(preview.rows[0]!.existingPlant?.id).toBe(plant.id);
    expect(preview.rows[2]!.problems[0]).toContain('repeated in this file');

    // The first of a repeated pair still goes in.
    const done = (
      await org.admin.post(`/plant-imports/${preview.id}/commit`).expect(200)
    ).body as PlantImportDetail;
    expect(done.rows.map((r) => r.status)).toEqual([
      'invalid',
      'imported',
      'invalid',
    ]);
  });

  it('needs confirmation for a matching Plant Number or Serial (IPL-005)', async () => {
    const plantNumber = `PN-${uid()}`;
    await org.admin
      .post('/plants', {
        name: `Numbered ${uid()}`,
        plantNumber,
        plantTypeId: typeId,
        ownership: 'hired',
        companyId: hireId,
        siteId,
      })
      .expect(201);
    const csv = [
      HEADER,
      `Same number,Crane,Hired,Crane Hire,${siteName},,,${plantNumber},`,
    ].join('\n');
    const preview = (await upload(org.admin, csv).expect(201))
      .body as PlantImportDetail;
    const candidate = preview.rows[0]!;
    expect(candidate.status).toBe('warning');

    const skipped = (
      await org.admin.post(`/plant-imports/${preview.id}/commit`).expect(200)
    ).body as PlantImportDetail;
    expect(skipped.counts.imported).toBe(0);

    await org.admin
      .patch(`/plant-imports/${preview.id}/rows/${candidate.id}`, {
        confirmed: true,
      })
      .expect(200);
    const done = (
      await org.admin.post(`/plant-imports/${preview.id}/commit`).expect(200)
    ).body as PlantImportDetail;
    expect(done.counts.imported).toBe(1);
  });

  it('refuses bad files and people without the permission', async () => {
    await upload(org.admin, 'Name\nx').expect(400);
    await upload(org.admin, HEADER).expect(400);
    await upload(org.admin, 'x', 'plant.pdf').expect(400);
    const member = await createActiveUser(t, org.admin, {
      firstName: 'Import',
      lastName: 'Operative',
      roleId: org.roleIds.operative,
      siteIds: [siteId],
    });
    await member.client.get('/plant-imports').expect(403);
    await upload(member.client, `${HEADER}\n${row('Nope')}`).expect(403);
  });
});
