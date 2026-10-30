import type supertest from 'supertest';
import type {
  AuditEvent,
  CheckTemplateDetail,
  Paginated,
  PlantMeters,
  PlantReception,
  PlantSaved,
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

type Agent = ReturnType<typeof supertest.agent>;

describe('Meter readings (FRD 14)', () => {
  let t: TestApp;
  let staff: Agent;
  let org: OrganisationFixture;
  let siteId: string;
  let typeId: string;
  let hireId: string;
  let hoursId: string;
  let milesId: string;

  const newPlant = async () =>
    (
      (
        await org.admin
          .post('/plants', {
            name: `Loader ${uid()}`,
            plantTypeId: typeId,
            ownership: 'hired',
            companyId: hireId,
            siteId,
          })
          .expect(201)
      ).body as PlantSaved
    ).plant;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff);
    siteId = await createSite(org.admin);
    const id = async (url: string, body: object) =>
      ((await org.admin.post(url, body).expect(201)).body as { id: string }).id;
    typeId = await id('/config/plant-types', { name: 'Loader' });
    hireId = await id('/config/plant-companies', {
      kind: 'hire_company',
      name: 'Load Hire',
    });
    hoursId = await id('/config/meter-types', { name: 'Hours', unit: 'hrs' });
    milesId = await id('/config/meter-types', { name: 'Miles', unit: 'mi' });
  });
  afterAll(() => t.close());

  it('records several meters and shows the newest of each (MTR-002, MTR-006)', async () => {
    const plant = await newPlant();
    await org.admin
      .post(`/plants/${plant.id}/meters`, {
        meterTypeId: hoursId,
        value: 100,
        readAt: '2026-01-01T09:00:00Z',
      })
      .expect(201);
    await org.admin
      .post(`/plants/${plant.id}/meters`, {
        meterTypeId: hoursId,
        value: 150.5,
        readAt: '2026-02-01T09:00:00Z',
      })
      .expect(201);
    const meters = (
      await org.admin
        .post(`/plants/${plant.id}/meters`, { meterTypeId: milesId, value: 40 })
        .expect(201)
    ).body as PlantMeters;
    expect(meters.readings.map((reading) => reading.value)).toEqual([
      40, 150.5, 100,
    ]);
    expect(
      meters.latest.find((reading) => reading.meterType.id === hoursId),
    ).toMatchObject({ value: 150.5, unit: 'hrs', source: 'manual' });
  });

  it('keeps the original value and reason when a reading is corrected (MTR-005)', async () => {
    const plant = await newPlant();
    const meters = (
      await org.admin
        .post(`/plants/${plant.id}/meters`, {
          meterTypeId: hoursId,
          value: 900,
        })
        .expect(201)
    ).body as PlantMeters;
    const reading = meters.readings[0]!;
    const operative = await createActiveUser(t, org.admin, {
      firstName: 'Meter',
      lastName: 'Operative',
      roleId: org.roleIds.operative,
      siteIds: [siteId],
    });
    await operative.client
      .post(`/meter-readings/${reading.id}/correct`, { value: 90, reason: 'x' })
      .expect(403);
    await org.admin
      .post(`/meter-readings/${reading.id}/correct`, { value: 90 })
      .expect(400);
    const corrected = (
      await org.admin
        .post(`/meter-readings/${reading.id}/correct`, {
          value: 90,
          reason: 'Extra zero typed',
        })
        .expect(200)
    ).body as PlantMeters;
    expect(corrected.readings[0]).toMatchObject({
      value: 90,
      corrections: [
        { previousValue: 900, newValue: 90, reason: 'Extra zero typed' },
      ],
    });
    const history = (
      await org.admin.get(`/plants/${plant.id}/history`).expect(200)
    ).body as Paginated<AuditEvent>;
    expect(history.items[0]!.action).toBe('meter.corrected');
  });

  it('refuses bad readings, archived meters and other organisations', async () => {
    const plant = await newPlant();
    await org.admin
      .post(`/plants/${plant.id}/meters`, { meterTypeId: hoursId, value: -1 })
      .expect(400);
    await org.admin
      .post(`/plants/${plant.id}/meters`, {
        meterTypeId: hoursId,
        value: 1,
        readAt: '2999-01-01T00:00:00Z',
      })
      .expect(400);
    const old = (
      (
        await org.admin
          .post('/config/meter-types', { name: `Old ${uid()}`, unit: 'x' })
          .expect(201)
      ).body as { id: string }
    ).id;
    await org.admin.post(`/config/meter-types/${old}/archive`).expect(200);
    await org.admin
      .post(`/plants/${plant.id}/meters`, { meterTypeId: old, value: 1 })
      .expect(400);
    const other = await setUpOrganisation(t, staff);
    await other.admin.get(`/plants/${plant.id}/meters`).expect(404);
  });

  it('puts a reception meter answer on the plant once, when it finishes (MTR-003)', async () => {
    const created = (
      await org.admin
        .post('/templates', { name: `Meters ${uid()}`, approvalMode: 'manual' })
        .expect(201)
    ).body as CheckTemplateDetail;
    await org.admin
      .put(`/templates/${created.id}/draft`, {
        questions: [
          { id: 'h', text: 'Hours', type: 'meter', meterTypeId: hoursId },
        ],
      })
      .expect(200);
    await org.admin.post(`/templates/${created.id}/publish`).expect(200);
    const plant = await newPlant();
    const check = (
      (
        await org.admin
          .post(`/plants/${plant.id}/reception`, { templateId: created.id })
          .expect(201)
      ).body as PlantReception
    ).current!;
    await org.admin
      .put(`/receptions/${check.id}/answers`, {
        answers: [{ questionId: 'h', value: 777 }],
      })
      .expect(200);
    await org.admin.post(`/receptions/${check.id}/submit`).expect(200);
    const waiting = (
      await org.admin.get(`/plants/${plant.id}/meters`).expect(200)
    ).body as PlantMeters;
    expect(waiting.readings).toHaveLength(0);
    await org.admin.post(`/receptions/${check.id}/approve`).expect(200);
    const done = (await org.admin.get(`/plants/${plant.id}/meters`).expect(200))
      .body as PlantMeters;
    expect(done.readings).toHaveLength(1);
    expect(done.readings[0]).toMatchObject({ value: 777, source: 'reception' });
  });
});
