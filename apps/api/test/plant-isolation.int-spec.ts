import { enterTenantRole } from '../src/database/db-context.js';
import type {
  CheckTemplateDetail,
  PlantDocument,
  PlantImportDetail,
  PlantSaved,
} from '@corecheck/shared';
import {
  createSite,
  createStaffAccount,
  type OrganisationFixture,
  setUpOrganisation,
  staffSession,
  uid,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

/** Milestone 2 records and files stay inside their organisation (ITDR). */
describe('Plant data isolation (TEN-002, DOC-AC-03)', () => {
  let t: TestApp;
  let a: OrganisationFixture;
  let b: OrganisationFixture;
  let plantId: string;
  let documentId: string;
  let versionId: string;
  let templateId: string;
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
    const siteName = `Site ${uid()}`;
    const siteId = await createSite(b.admin, siteName);
    const typeId = await id('/config/plant-types', { name: 'Dumper' });
    const companyId = await id('/config/plant-companies', {
      kind: 'hire_company',
      name: 'Dump Hire',
    });
    const documentTypeId = await id('/config/document-types', {
      name: 'Insurance',
      hasExpiry: false,
    });
    plantId = (
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
    const document = (
      await b.admin
        .post(`/plants/${plantId}/documents`)
        .field('documentTypeId', documentTypeId)
        .attach('file', PDF, {
          filename: 'cert.pdf',
          contentType: 'application/pdf',
        })
        .expect(201)
    ).body as PlantDocument;
    documentId = document.id;
    versionId = document.versions[0]!.id;
    templateId = (
      (
        await b.admin
          .post('/templates', { name: `Reception ${uid()}` })
          .expect(201)
      ).body as CheckTemplateDetail
    ).id;
    importId = (
      (
        await b.admin
          .post('/plant-imports')
          .attach(
            'file',
            Buffer.from(
              `Equipment Name,Plant Type,Ownership Type,Owner/Hire Company,Site\nX,Dumper,Hired,Dump Hire,${siteName}\n`,
            ),
            { filename: 'plant.csv', contentType: 'text/csv' },
          )
          .expect(201)
      ).body as PlantImportDetail
    ).id;
  });
  afterAll(() => t.close());

  it('answers "not found" to another organisation for every plant record', async () => {
    for (const path of [
      `/plants/${plantId}`,
      `/plants/${plantId}/history`,
      `/plants/${plantId}/documents`,
      `/plants/${plantId}/reception`,
      `/plants/${plantId}/meters`,
      `/documents/${documentId}/versions/${versionId}/file`,
      `/templates/${templateId}`,
      `/plant-imports/${importId}`,
      `/plant-imports/${importId}/report`,
    ])
      await a.admin.get(path).expect(404);
    await a.admin.post(`/plant-imports/${importId}/commit`).expect(404);
    await a.admin.post(`/plants/${plantId}/archive`).expect(404);
  });

  it('shows another organisation nothing in the registers', async () => {
    const list = async (path: string) =>
      (await a.admin.get(path).expect(200)).body as
        { items: unknown[] } | unknown[];
    expect((await list('/plants')) as { items: unknown[] }).toMatchObject({
      items: [],
    });
    expect((await list('/documents')) as { items: unknown[] }).toMatchObject({
      items: [],
    });
    expect(await list('/plant-imports')).toEqual([]);
    expect(await list('/templates')).toEqual([]);
  });

  it('hides every Milestone 2 table from another organisation inside the database', async () => {
    const tables = [
      'plants',
      'plant_documents',
      'plant_document_versions',
      'check_templates',
      'check_template_versions',
      'plant_imports',
      'plant_import_rows',
      'plant_types',
      'plant_companies',
      'document_types',
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
  });
});
