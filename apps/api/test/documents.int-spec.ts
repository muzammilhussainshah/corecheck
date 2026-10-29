import type supertest from 'supertest';
import type {
  AuditEvent,
  DocumentRegisterRow,
  OrganisationDetail,
  Paginated,
  PlantDetail,
  PlantDocument,
  PlantDocuments,
  PlantSaved,
  PlantSummary,
} from '@corecheck/shared';
import { ComplianceSweepService } from '../src/plants/compliance-sweep.service.js';
import {
  type ApiClient,
  createActiveUser,
  createSite,
  createStaffAccount,
  type OrganisationFixture,
  setUpOrganisation,
  staffSession,
  uid,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

type Agent = ReturnType<typeof supertest.agent>;

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n',
);

/** A tiny JPEG with an EXIF block that must not be kept. */
const JPEG_WITH_EXIF = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  Buffer.from([0xff, 0xe1, 0x00, 0x10]),
  Buffer.from('Exif\0\0GPS-DATA'),
  Buffer.from([0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 0x12, 0x34, 0xff, 0xd9]),
]);

const day = (offset: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

const binary = (request: supertest.Test) =>
  request.buffer(true).parse((res, callback) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  });

describe('Plant documents and compliance (FRD 9)', () => {
  let t: TestApp;
  let staff: Agent;
  let org: OrganisationFixture;
  let siteId: string;
  let typeId: string;
  let hireId: string;
  let lolerId: string;

  const upload = (
    client: ApiClient,
    plantId: string,
    fields: Record<string, string>,
    file: Buffer = PDF,
    filename = 'certificate.pdf',
  ) => {
    const request = client.post(`/plants/${plantId}/documents`);
    for (const [key, value] of Object.entries(fields))
      void request.field(key, value);
    return request.attach('file', file, { filename });
  };

  const newPlant = async (client: ApiClient = org.admin) =>
    (
      (
        await client
          .post('/plants', {
            name: `Crane ${uid()}`,
            plantTypeId: typeId,
            ownership: 'hired',
            companyId: hireId,
            siteId,
          })
          .expect(201)
      ).body as PlantSaved
    ).plant;

  /** Approval arrives with reception (phase 4); set it directly here. */
  const approve = (plantId: string) =>
    t.dataSource.query(
      `update corecheck.plants set status = 'approved', approved_at = now() where id = $1`,
      [plantId],
    );

  const documents = async (plantId: string, client: ApiClient = org.admin) =>
    (await client.get(`/plants/${plantId}/documents`).expect(200))
      .body as PlantDocuments;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff);
    siteId = await createSite(org.admin);
    const id = async (url: string, body: object) =>
      ((await org.admin.post(url, body).expect(201)).body as { id: string }).id;
    typeId = await id('/config/plant-types', { name: 'Tower crane' });
    hireId = await id('/config/plant-companies', {
      kind: 'hire_company',
      name: 'Lift Hire',
    });
    lolerId = await id('/config/document-types', {
      name: 'LOLER',
      warningDays: 30,
    });
    await org.admin
      .put(`/config/plant-types/${typeId}/required-documents`, {
        documentTypeIds: [lolerId],
      })
      .expect(200);
  });
  afterAll(() => t.close());

  it('reports a mandatory document as missing until one is uploaded and verified (DOC-001, DOC-005)', async () => {
    const plant = await newPlant();
    expect((await documents(plant.id)).compliance).toMatchObject({
      state: 'non_compliant',
      requirements: [{ documentType: { id: lolerId }, state: 'missing' }],
    });

    const uploaded = (
      await upload(org.admin, plant.id, {
        documentTypeId: lolerId,
        reference: 'LOL-1',
        issuedOn: day(-10),
        expiresOn: day(200),
      }).expect(201)
    ).body as PlantDocument;
    expect(uploaded).toMatchObject({
      state: 'awaiting_verification',
      versions: [{ version: 1, verification: 'awaiting', reference: 'LOL-1' }],
    });
    expect((await documents(plant.id)).compliance.state).toBe('non_compliant');

    const verified = (
      await org.admin.post(`/documents/${uploaded.id}/verify`).expect(200)
    ).body as PlantDocument;
    expect(verified.state).toBe('valid');
    expect(verified.versions[0]!.verifiedBy).toBeTruthy();
    expect((await documents(plant.id)).compliance.state).toBe('compliant');
    const listed = (
      (await org.admin.get(`/plants?search=${plant.assetId}`).expect(200))
        .body as Paginated<PlantSummary>
    ).items[0]!;
    expect(listed.compliance).toBe('compliant');
  });

  it('works out expiry from the dates and the type’s warning (DOC-005)', async () => {
    const plant = await newPlant();
    const soon = (
      await upload(org.admin, plant.id, {
        documentTypeId: lolerId,
        expiresOn: day(10),
      }).expect(201)
    ).body as PlantDocument;
    await org.admin.post(`/documents/${soon.id}/verify`).expect(200);
    expect((await documents(plant.id)).documents[0]!.state).toBe(
      'approaching_expiry',
    );
    // Approaching expiry still counts as held.
    expect((await documents(plant.id)).compliance.state).toBe('expiring');

    const old = (
      await upload(org.admin, plant.id, {
        documentTypeId: lolerId,
        expiresOn: day(-1),
      }).expect(201)
    ).body as PlantDocument;
    expect(old.state).toBe('expired');
  });

  it('checks the file and the dates it is given', async () => {
    const plant = await newPlant();
    const notAllowed = await upload(
      org.admin,
      plant.id,
      { documentTypeId: lolerId, expiresOn: day(30) },
      Buffer.from('just text'),
      'notes.pdf',
    ).expect(400);
    expect(notAllowed.body.fieldErrors[0]).toEqual({
      field: 'file',
      message: 'Upload a PDF, JPEG or PNG file.',
    });
    const noExpiry = await upload(org.admin, plant.id, {
      documentTypeId: lolerId,
    }).expect(400);
    expect(noExpiry.body.fieldErrors[0].field).toBe('expiresOn');
    await upload(org.admin, plant.id, {
      documentTypeId: lolerId,
      issuedOn: day(5),
      expiresOn: day(1),
    }).expect(400);
    const noFile = await org.admin
      .post(`/plants/${plant.id}/documents`)
      .field('documentTypeId', lolerId)
      .field('expiresOn', day(30))
      .expect(400);
    expect(noFile.body.fieldErrors[0].field).toBe('file');
  });

  it('removes photo metadata before keeping the file', async () => {
    const plant = await newPlant();
    const photo = (
      await upload(
        org.admin,
        plant.id,
        { documentTypeId: lolerId, expiresOn: day(30) },
        JPEG_WITH_EXIF,
        'C:\\photos\\cert.jpg',
      ).expect(201)
    ).body as PlantDocument;
    const version = photo.versions[0]!;
    expect(version).toMatchObject({
      contentType: 'image/jpeg',
      fileName: 'cert.jpg',
    });
    const file = await binary(
      org.admin.get(`/documents/${photo.id}/versions/${version.id}/file`),
    ).expect(200);
    expect(file.headers['x-filename']).toBe('cert.jpg');
    expect((file.body as Buffer).includes(Buffer.from('GPS-DATA'))).toBe(false);
  });

  it('keeps every earlier version when a document is replaced or rejected (DOC-007)', async () => {
    const plant = await newPlant();
    const first = (
      await upload(org.admin, plant.id, {
        documentTypeId: lolerId,
        expiresOn: day(100),
      }).expect(201)
    ).body as PlantDocument;
    const rejected = (
      await org.admin
        .post(`/documents/${first.id}/reject`, { reason: 'Wrong crane' })
        .expect(200)
    ).body as PlantDocument;
    expect(rejected).toMatchObject({
      state: 'rejected',
      versions: [{ rejectionReason: 'Wrong crane' }],
    });
    await org.admin.post(`/documents/${first.id}/verify`).expect(409);

    const replaced = (
      await org.admin
        .post(`/documents/${first.id}/versions`)
        .field('expiresOn', day(300))
        .attach('file', PDF, { filename: 'right.pdf' })
        .expect(201)
    ).body as PlantDocument;
    expect(replaced.state).toBe('awaiting_verification');
    expect(replaced.versions.map((v) => [v.version, v.verification])).toEqual([
      [2, 'awaiting'],
      [1, 'rejected'],
    ]);
    // The first file is still there.
    await binary(
      org.admin.get(
        `/documents/${first.id}/versions/${first.versions[0]!.id}/file`,
      ),
    ).expect(200);

    const history = (
      await org.admin.get(`/plants/${plant.id}/history`).expect(200)
    ).body as Paginated<AuditEvent>;
    expect(history.items.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        'document.uploaded',
        'document.rejected',
        'document.replaced',
      ]),
    );
  });

  it('restricts approved plant whose mandatory documents lapse, and lifts it only with valid ones or an override (DOC-AC-01, DOC-008)', async () => {
    const plant = await newPlant();
    await approve(plant.id);

    // The scheduled check takes it out of use: LOLER is missing.
    const swept = await t.app.get(ComplianceSweepService).sweep();
    expect(swept).toBeGreaterThanOrEqual(1);
    const restricted = (await org.admin.get(`/plants/${plant.id}`).expect(200))
      .body as PlantDetail;
    expect(restricted).toMatchObject({
      status: 'restricted',
      statusNote: 'Mandatory documents not valid: LOLER (Missing)',
    });
    const history = (
      await org.admin.get(`/plants/${plant.id}/history`).expect(200)
    ).body as Paginated<AuditEvent>;
    expect(history.items[0]).toMatchObject({
      action: 'plant.restricted',
      actorType: 'system',
      metadata: { automatic: true, documents: ['LOLER (Missing)'] },
    });

    // Back to service needs the documents...
    const blocked = await org.admin
      .post(`/plants/${plant.id}/return-to-service`, {})
      .expect(409);
    expect(blocked.body).toMatchObject({
      code: 'DOCUMENTS_NOT_VALID',
      details: { documents: ['LOLER (Missing)'] },
    });

    // ...or an override with a reason and a review date, by someone allowed.
    const supervisor = await createActiveUser(t, org.admin, {
      firstName: 'Doc',
      lastName: 'Supervisor',
      roleId: org.roleIds.supervisor,
      siteIds: [siteId],
    });
    await supervisor.client
      .post(`/plants/${plant.id}/return-to-service`, {
        override: true,
        note: 'Certificate in the post',
        reviewOn: day(7),
      })
      .expect(403);
    await org.admin
      .post(`/plants/${plant.id}/return-to-service`, {
        override: true,
        note: 'Certificate in the post',
      })
      .expect(400);
    const overridden = (
      await org.admin
        .post(`/plants/${plant.id}/return-to-service`, {
          override: true,
          note: 'Certificate in the post',
          reviewOn: day(7),
        })
        .expect(200)
    ).body as PlantDetail;
    expect(overridden.status).toBe('approved');
    expect((await documents(plant.id)).compliance.override).toMatchObject({
      until: day(7),
      note: 'Certificate in the post',
    });

    // While the override lasts, the check leaves it Online.
    await t.app.get(ComplianceSweepService).sweep();
    expect(
      (
        (await org.admin.get(`/plants/${plant.id}`).expect(200))
          .body as PlantDetail
      ).status,
    ).toBe('approved');
  });

  it('restricts approved plant the moment its document is rejected', async () => {
    const plant = await newPlant();
    const doc = (
      await upload(org.admin, plant.id, {
        documentTypeId: lolerId,
        expiresOn: day(100),
      }).expect(201)
    ).body as PlantDocument;
    await org.admin.post(`/documents/${doc.id}/verify`).expect(200);
    await approve(plant.id);
    await org.admin
      .post(`/documents/${doc.id}/reject`, { reason: 'Forged' })
      .expect(200);
    const after = (await org.admin.get(`/plants/${plant.id}`).expect(200))
      .body as PlantDetail;
    expect(after.status).toBe('restricted');
    expect(after.statusNote).toMatch(/LOLER \(Rejected\)/);
  });

  it('lets everyone upload but only reviewers verify and only managers archive (DOC-003)', async () => {
    const operative = await createActiveUser(t, org.admin, {
      firstName: 'Doc',
      lastName: 'Operative',
      roleId: org.roleIds.operative,
      siteIds: [siteId],
    });
    const plant = await newPlant();
    const doc = (
      await upload(operative.client, plant.id, {
        documentTypeId: lolerId,
        expiresOn: day(60),
      }).expect(201)
    ).body as PlantDocument;
    expect(doc.capabilities).toEqual({
      replace: true,
      verify: false,
      archive: false,
    });
    await operative.client.post(`/documents/${doc.id}/verify`).expect(403);
    await operative.client.post(`/documents/${doc.id}/archive`).expect(403);

    await org.admin.post(`/documents/${doc.id}/archive`).expect(200);
    const listed = await documents(plant.id);
    expect(listed.documents[0]!.state).toBe('archived');
    // An archived document no longer counts.
    expect(listed.compliance.requirements[0]!.state).toBe('missing');
  });

  it('keeps documents to the plant’s sites and organisation (DOC-AC-03)', async () => {
    const plant = await newPlant();
    const doc = (
      await upload(org.admin, plant.id, {
        documentTypeId: lolerId,
        expiresOn: day(60),
      }).expect(201)
    ).body as PlantDocument;
    const fileUrl = `/documents/${doc.id}/versions/${doc.versions[0]!.id}/file`;

    const elsewhere = await createActiveUser(t, org.admin, {
      firstName: 'Other',
      lastName: 'Site',
      roleId: org.roleIds.operative,
      siteIds: [await createSite(org.admin)],
    });
    await elsewhere.client.get(`/plants/${plant.id}/documents`).expect(404);
    await elsewhere.client.get(fileUrl).expect(404);

    const other = await setUpOrganisation(t, staff);
    await other.admin.get(fileUrl).expect(404);
    await other.admin.post(`/documents/${doc.id}/verify`).expect(404);
  });

  it('lists documents across plant with state filters', async () => {
    const plant = await newPlant();
    await upload(org.admin, plant.id, {
      documentTypeId: lolerId,
      reference: `EXP-${uid()}`,
      expiresOn: day(-3),
    }).expect(201);
    const expired = (
      await org.admin.get('/documents?state=expired&pageSize=100').expect(200)
    ).body as Paginated<DocumentRegisterRow>;
    expect(expired.items.length).toBeGreaterThan(0);
    expect(expired.items.every((row) => row.state === 'expired')).toBe(true);
    expect(expired.items.some((row) => row.plant.id === plant.id)).toBe(true);
  });

  it('counts document files in the organisation’s storage usage (IAD-004)', async () => {
    const detail = (
      await staff.get(`/platform/organisations/${org.orgId}`).expect(200)
    ).body as OrganisationDetail;
    expect(detail.usage.storedFiles).toBeGreaterThan(0);
    expect(detail.usage.storageBytes).toBeGreaterThan(0);
  });
});
