import type supertest from 'supertest';
import type {
  AuditEvent,
  CreatePlantInput,
  CustomField,
  Paginated,
  PlantDetail,
  PlantDuplicates,
  PlantSaved,
  PlantSummary,
} from '@corecheck/shared';
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

interface Basics {
  siteId: string;
  otherSiteId: string;
  typeId: string;
  ownerId: string;
  hireId: string;
}

/** The configuration plant needs: sites, a type and both kinds of company. */
const setUpBasics = async (admin: ApiClient): Promise<Basics> => {
  const id = async (url: string, body: object) =>
    ((await admin.post(url, body).expect(201)).body as { id: string }).id;
  return {
    siteId: await createSite(admin),
    otherSiteId: await createSite(admin),
    typeId: await id('/config/plant-types', { name: `Excavator ${uid()}` }),
    ownerId: await id('/config/plant-companies', {
      kind: 'owner',
      name: `Own Co ${uid()}`,
    }),
    hireId: await id('/config/plant-companies', {
      kind: 'hire_company',
      name: `Hire Co ${uid()}`,
    }),
  };
};

describe('Plant register (FRD 7)', () => {
  let t: TestApp;
  let staff: Agent;
  let org: OrganisationFixture;
  let b: Basics;

  const plantInput = (
    overrides: Partial<CreatePlantInput> = {},
  ): CreatePlantInput => ({
    name: '20t excavator',
    plantTypeId: b.typeId,
    ownership: 'hired',
    companyId: b.hireId,
    siteId: b.siteId,
    ...overrides,
  });

  const register = async (
    client: ApiClient,
    overrides: Partial<CreatePlantInput> = {},
  ) =>
    (await client.post('/plants', plantInput(overrides)).expect(201))
      .body as PlantSaved;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff);
    b = await setUpBasics(org.admin);
  });
  afterAll(() => t.close());

  it('generates System Asset IDs in sequence and starts plant Pending Reception (PLT-002, PLC-001)', async () => {
    const first = await register(org.admin);
    const second = await register(org.admin, { name: 'Dumper' });
    expect(first.plant.assetId).toMatch(/^PLT-\d{6}$/);
    expect(Number(second.plant.assetId.slice(4))).toBe(
      Number(first.plant.assetId.slice(4)) + 1,
    );
    expect(first.plant).toMatchObject({
      status: 'pending_reception',
      ownership: 'hired',
      archivedAt: null,
    });
    expect(first.plant.capabilities.edit).toBe(true);
  });

  it('never saves two plant with one System Asset ID (PLT-003, PLT-AC-01)', async () => {
    const original = await register(org.admin, { assetId: 'EX-100' });
    const refused = await org.admin
      .post('/plants', plantInput({ assetId: 'ex-100' }))
      .expect(409);
    expect(refused.body.fieldErrors).toEqual([
      {
        field: 'assetId',
        message: 'A plant with this System Asset ID already exists.',
      },
    ]);
    expect(refused.body.details).toEqual({ plantId: original.plant.id });

    // A generated ID skips one that was typed in by hand.
    const next = (await register(org.admin)).plant.assetId;
    const typed = `PLT-${String(Number(next.slice(4)) + 1).padStart(6, '0')}`;
    await register(org.admin, { assetId: typed });
    expect((await register(org.admin)).plant.assetId).not.toBe(typed);
  });

  it('warns about matching Plant and Serial Numbers but still saves (PLT-004)', async () => {
    const number = `PN-${uid()}`;
    const first = await register(org.admin, { plantNumber: number });
    const second = await register(org.admin, {
      plantNumber: number.toLowerCase(),
    });
    expect(second.duplicates.plantNumber.map((p) => p.id)).toEqual([
      first.plant.id,
    ]);
    const serial = `SN-${uid()}`;
    await register(org.admin, { serialNumber: serial });
    const check = (
      await org.admin
        .get(`/plants/duplicates?serialNumber=${serial}`)
        .expect(200)
    ).body as PlantDuplicates;
    expect(check.serialNumber).toHaveLength(1);
  });

  it('checks required fields and that references fit together (PLT-006)', async () => {
    const missing = await org.admin.post('/plants', {}).expect(400);
    const fields = (missing.body.fieldErrors as Array<{ field: string }>).map(
      (error) => error.field,
    );
    expect(fields).toEqual(
      expect.arrayContaining([
        'name',
        'plantTypeId',
        'ownership',
        'companyId',
        'siteId',
      ]),
    );

    const wrongCompany = await org.admin
      .post('/plants', plantInput({ ownership: 'owned', companyId: b.hireId }))
      .expect(400);
    expect(wrongCompany.body.fieldErrors[0]).toMatchObject({
      field: 'companyId',
    });

    const area = (
      await org.admin
        .post(`/sites/${b.otherSiteId}/areas`, { name: `Yard ${uid()}` })
        .expect(201)
    ).body as { id: string };
    const wrongArea = await org.admin
      .post('/plants', plantInput({ areaId: area.id }))
      .expect(400);
    expect(wrongArea.body.fieldErrors[0].field).toBe('areaId');

    const archivedType = (
      await org.admin
        .post('/config/plant-types', { name: `Old ${uid()}` })
        .expect(201)
    ).body as { id: string };
    await org.admin
      .post(`/config/plant-types/${archivedType.id}/archive`)
      .expect(200);
    await org.admin
      .post('/plants', plantInput({ plantTypeId: archivedType.id }))
      .expect(400);
  });

  it('validates custom field values against their configuration (PLT-008)', async () => {
    const other = await setUpOrganisation(t, staff);
    const basics = await setUpBasics(other.admin);
    const fuel = (
      await other.admin
        .post('/config/custom-fields', {
          label: 'Fuel',
          fieldType: 'select',
          options: ['Diesel', 'Electric'],
          required: true,
        })
        .expect(201)
    ).body as CustomField;
    const weight = (
      await other.admin
        .post('/config/custom-fields', { label: 'Weight', fieldType: 'number' })
        .expect(201)
    ).body as CustomField;
    const input = {
      name: 'Generator',
      plantTypeId: basics.typeId,
      ownership: 'owned',
      companyId: basics.ownerId,
      siteId: basics.siteId,
    };

    const noFuel = await other.admin.post('/plants', input).expect(400);
    expect(noFuel.body.fieldErrors[0]).toEqual({
      field: `customValues.${fuel.id}`,
      message: 'Fuel is required.',
    });
    await other.admin
      .post('/plants', { ...input, customValues: { [fuel.id]: 'Petrol' } })
      .expect(400);
    await other.admin
      .post('/plants', {
        ...input,
        customValues: { [fuel.id]: 'Diesel', [weight.id]: 'heavy' },
      })
      .expect(400);
    const saved = (
      await other.admin
        .post('/plants', {
          ...input,
          customValues: { [fuel.id]: 'Diesel', [weight.id]: 1200 },
        })
        .expect(201)
    ).body as PlantSaved;
    expect(saved.plant.customValues).toEqual({
      [fuel.id]: 'Diesel',
      [weight.id]: 1200,
    });
  });

  it('keeps plant to the user’s sites (ROL-AC-02)', async () => {
    const atOther = await register(org.admin, { siteId: b.otherSiteId });
    const operative = await createActiveUser(t, org.admin, {
      firstName: 'Plant',
      lastName: 'Operative',
      roleId: org.roleIds.operative,
      siteIds: [b.siteId],
    });
    await operative.client.get(`/plants/${atOther.plant.id}`).expect(404);
    const listed = (await operative.client.get('/plants').expect(200))
      .body as Paginated<PlantSummary>;
    expect(listed.items.every((plant) => plant.site.id === b.siteId)).toBe(
      true,
    );
    const refused = await operative.client
      .post('/plants', plantInput({ siteId: b.otherSiteId }))
      .expect(403);
    expect(refused.body.code).toBe('OUT_OF_SCOPE');
  });

  it('lets an Operative edit only their own Pending Reception plant (PLC-003)', async () => {
    const operative = await createActiveUser(t, org.admin, {
      firstName: 'Draft',
      lastName: 'Owner',
      roleId: org.roleIds.operative,
      siteIds: [b.siteId],
    });
    const mine = await register(operative.client, { name: 'Mine' });
    expect(mine.plant.capabilities).toMatchObject({
      edit: true,
      editIdentifiers: true,
      archive: false,
      restrict: false,
    });
    await operative.client
      .patch(`/plants/${mine.plant.id}`, {
        make: 'JCB',
        assetId: `OP-${uid()}`,
      })
      .expect(200);

    const admins = await register(org.admin, { name: 'Not mine' });
    const refused = await operative.client
      .patch(`/plants/${admins.plant.id}`, { make: 'JCB' })
      .expect(403);
    expect(refused.body.message).toMatch(/registered this plant/);

    // Once it leaves Pending Reception, the draft is no longer theirs to edit.
    await org.admin
      .post(`/plants/${mine.plant.id}/restrict`, { note: 'Arrived damaged' })
      .expect(200);
    await operative.client
      .patch(`/plants/${mine.plant.id}`, { make: 'CAT' })
      .expect(403);
  });

  it('needs the identifier permission to change an Asset ID or site', async () => {
    const supervisor = await createActiveUser(t, org.admin, {
      firstName: 'Id',
      lastName: 'Supervisor',
      roleId: org.roleIds.supervisor,
      siteIds: [b.siteId, b.otherSiteId],
    });
    const plant = await register(org.admin);
    // Supervisors may not edit plant master data at all.
    await supervisor.client
      .patch(`/plants/${plant.plant.id}`, { siteId: b.otherSiteId })
      .expect(403);
    const manager = await createActiveUser(t, org.admin, {
      firstName: 'Id',
      lastName: 'Manager',
      roleId: org.roleIds.manager,
      siteIds: [b.siteId, b.otherSiteId],
    });
    const moved = (
      await manager.client
        .patch(`/plants/${plant.plant.id}`, { siteId: b.otherSiteId })
        .expect(200)
    ).body as PlantSaved;
    expect(moved.plant.site.id).toBe(b.otherSiteId);
  });

  it('restricts with a classification and lifts it to the right status (PLC-002, PLC-005)', async () => {
    const plant = await register(org.admin);
    const restricted = (
      await org.admin
        .post(`/plants/${plant.plant.id}/restrict`, {
          reason: 'quarantined',
          note: 'Hydraulic leak',
        })
        .expect(200)
    ).body as PlantDetail;
    expect(restricted).toMatchObject({
      status: 'restricted',
      restrictionReason: 'quarantined',
      statusNote: 'Hydraulic leak',
    });
    await org.admin
      .post(`/plants/${plant.plant.id}/restrict`, { reason: 'quarantined' })
      .expect(400);

    // Never approved, so lifting the restriction sends it back to reception.
    const lifted = (
      await org.admin
        .post(`/plants/${plant.plant.id}/return-to-service`, {})
        .expect(200)
    ).body as PlantDetail;
    expect(lifted).toMatchObject({
      status: 'pending_reception',
      restrictionReason: null,
    });
    await org.admin
      .post(`/plants/${plant.plant.id}/return-to-service`, {})
      .expect(409);
    await org.admin
      .post(`/plants/${plant.plant.id}/return-to-service`, { override: true })
      .expect(400);

    const history = (
      await org.admin.get(`/plants/${plant.plant.id}/history`).expect(200)
    ).body as Paginated<AuditEvent>;
    expect(history.items.map((event) => event.action)).toEqual([
      'plant.returned_to_service',
      'plant.restricted',
      'plant.created',
    ]);
    expect(history.items[1]!.after).toMatchObject({
      status: 'restricted',
      note: 'Hydraulic leak',
    });
  });

  it('archives and restores plant, keeping it out of the register meanwhile (PLC-006)', async () => {
    const plant = await register(org.admin);
    await org.admin.post(`/plants/${plant.plant.id}/archive`).expect(200);
    const active = (await org.admin.get('/plants?pageSize=100').expect(200))
      .body as Paginated<PlantSummary>;
    expect(active.items.map((p) => p.id)).not.toContain(plant.plant.id);
    const archived = (
      await org.admin.get('/plants?status=archived&pageSize=100').expect(200)
    ).body as Paginated<PlantSummary>;
    expect(archived.items.map((p) => p.id)).toContain(plant.plant.id);
    await org.admin
      .patch(`/plants/${plant.plant.id}`, { name: 'Changed' })
      .expect(409);
    const restored = (
      await org.admin.post(`/plants/${plant.plant.id}/restore`).expect(200)
    ).body as PlantDetail;
    expect(restored).toMatchObject({
      archivedAt: null,
      status: 'pending_reception',
    });
  });

  it('searches and filters the register (PLR-002, PLR-003)', async () => {
    const serial = `FIND-${uid()}`;
    const plant = await register(org.admin, {
      serialNumber: serial,
      ownership: 'owned',
      companyId: b.ownerId,
    });
    const bySerial = (
      await org.admin.get(`/plants?search=${serial.toLowerCase()}`).expect(200)
    ).body as Paginated<PlantSummary>;
    expect(bySerial.items.map((p) => p.id)).toEqual([plant.plant.id]);
    const owned = (
      await org.admin
        .get(`/plants?ownership=owned&companyId=${b.ownerId}&pageSize=100`)
        .expect(200)
    ).body as Paginated<PlantSummary>;
    expect(owned.items.every((p) => p.ownership === 'owned')).toBe(true);
  });

  it('exports the register to CSV and Excel, safely and audited (PLR-004)', async () => {
    await register(org.admin, { name: '=HYPERLINK("http://evil")' });
    const csv = await org.admin.get('/plants/export?format=csv').expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['x-filename']).toMatch(
      /^plant-register-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    // No attachment header: browsers would turn the fetch into a download.
    expect(csv.headers['content-disposition']).toBeUndefined();
    const text = csv.text.replace(/^﻿/, '');
    expect(text.split('\r\n')[0]).toMatch(/^System Asset ID,Plant Number/);
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);

    const xlsx = await org.admin
      .get('/plants/export?format=xlsx')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    const operative = await createActiveUser(t, org.admin, {
      firstName: 'No',
      lastName: 'Export',
      roleId: org.roleIds.operative,
      siteIds: [b.siteId],
    });
    await operative.client.get('/plants/export').expect(403);

    const audit = (
      await org.admin.get('/audit-events?category=plant').expect(200)
    ).body as Paginated<AuditEvent>;
    expect(audit.items.some((event) => event.action === 'plant.exported')).toBe(
      true,
    );
  });

  it('opens a QR code only for signed-in users who may see the plant (PLT-AC-04)', async () => {
    const plant = await register(org.admin, { siteId: b.otherSiteId });
    const [{ token }] = (await t.dataSource.query(
      'select qr_token as token from corecheck.plants where id = $1',
      [plant.plant.id],
    )) as [{ token: string }];

    await t.http.get(`/plants/qr/${token}`).expect(401);
    const found = (await org.admin.get(`/plants/qr/${token}`).expect(200))
      .body as { id: string };
    expect(found.id).toBe(plant.plant.id);

    const elsewhere = await createActiveUser(t, org.admin, {
      firstName: 'Qr',
      lastName: 'Outside',
      roleId: org.roleIds.operative,
      siteIds: [b.siteId],
    });
    await elsewhere.client.get(`/plants/qr/${token}`).expect(404);
    const otherOrg = await setUpOrganisation(t, staff);
    await otherOrg.admin.get(`/plants/qr/${token}`).expect(404);
    await org.admin.get('/plants/qr/not-a-real-token!').expect(404);

    const pdf = await org.admin
      .get(`/plants/qr-labels?ids=${plant.plant.id}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['x-filename']).toMatch(/.pdf$/);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('keeps each organisation’s plant to itself', async () => {
    const plant = await register(org.admin);
    const other = await setUpOrganisation(t, staff);
    await other.admin.get(`/plants/${plant.plant.id}`).expect(404);
    await other.admin
      .patch(`/plants/${plant.plant.id}`, { name: 'Taken' })
      .expect(404);
    const theirs = (await other.admin.get('/plants').expect(200))
      .body as Paginated<PlantSummary>;
    expect(theirs.total).toBe(0);
    // The same Asset ID may exist in another organisation.
    const basics = await setUpBasics(other.admin);
    await other.admin
      .post('/plants', {
        name: 'Same ID',
        assetId: plant.plant.assetId,
        plantTypeId: basics.typeId,
        ownership: 'owned',
        companyId: basics.ownerId,
        siteId: basics.siteId,
      })
      .expect(201);
  });
});
