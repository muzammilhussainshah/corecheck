import type supertest from 'supertest';
import type {
  AuditEvent,
  CustomField,
  DocumentType,
  MeterType,
  Paginated,
  PlantCompany,
  PlantType,
} from '@corecheck/shared';
import {
  createActiveUser,
  createSite,
  createStaffAccount,
  type OrganisationFixture,
  setUpOrganisation,
  staffSession,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

type Agent = ReturnType<typeof supertest.agent>;

describe('Plant configuration (FRD ADM-003)', () => {
  let t: TestApp;
  let staff: Agent;
  let org: OrganisationFixture;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff);
  });
  afterAll(() => t.close());

  it('creates, edits, archives and restores each list, and audits it', async () => {
    const lists: Array<[string, object, object]> = [
      ['plant-types', { name: 'Excavator' }, { description: 'Tracked' }],
      ['plant-categories', { name: 'Heavy plant' }, { name: 'Heavy' }],
      [
        'plant-companies',
        { kind: 'hire_company', name: 'Speedy Hire', contactEmail: '' },
        { contactName: 'Sam' },
      ],
      ['meter-types', { name: 'Hours', unit: 'hrs' }, { unit: 'h' }],
      [
        'document-types',
        { name: 'LOLER', warningDays: 14 },
        { warningDays: 21 },
      ],
      [
        'custom-fields',
        { label: 'Colour', fieldType: 'text' },
        { required: true },
      ],
    ];

    for (const [kind, create, change] of lists) {
      const created = (
        await org.admin.post(`/config/${kind}`, create).expect(201)
      ).body as { id: string; archivedAt: string | null };
      expect(created.archivedAt).toBeNull();
      const updated = (
        await org.admin
          .patch(`/config/${kind}/${created.id}`, change)
          .expect(200)
      ).body as Record<string, unknown>;
      expect(updated).toMatchObject(change);

      await org.admin.post(`/config/${kind}/${created.id}/archive`).expect(200);
      const active = (await org.admin.get(`/config/${kind}`).expect(200))
        .body as Array<{ id: string }>;
      expect(active.map((item) => item.id)).not.toContain(created.id);
      const all = (
        await org.admin.get(`/config/${kind}?includeArchived=true`).expect(200)
      ).body as Array<{ id: string }>;
      expect(all.map((item) => item.id)).toContain(created.id);
      await org.admin.post(`/config/${kind}/${created.id}/restore`).expect(200);
    }

    const audit = (
      await org.admin.get('/audit-events?category=plant_type').expect(200)
    ).body as Paginated<AuditEvent>;
    expect(audit.items.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        'plant_type.created',
        'plant_type.updated',
        'plant_type.archived',
        'plant_type.restored',
      ]),
    );
  });

  it('stores blank optional text as empty and keeps a company kind fixed', async () => {
    const company = (
      await org.admin
        .post('/config/plant-companies', {
          kind: 'owner',
          name: 'Northwind Plant Ltd',
          contactPhone: '',
        })
        .expect(201)
    ).body as PlantCompany;
    expect(company).toMatchObject({ kind: 'owner', contactPhone: null });
    const unchanged = (
      await org.admin
        .patch(`/config/plant-companies/${company.id}`, {
          kind: 'hire_company',
        })
        .expect(200)
    ).body as PlantCompany;
    expect(unchanged.kind).toBe('owner');
  });

  it('rejects duplicate names with a clear message', async () => {
    await org.admin.post('/config/meter-types', {
      name: 'Mileage',
      unit: 'mi',
    });
    const duplicate = await org.admin
      .post('/config/meter-types', { name: 'MILEAGE', unit: 'km' })
      .expect(409);
    expect(duplicate.body.message).toBe(
      'A meter type with this name already exists.',
    );
    // Named against the field, so the form shows it there (VAL-002).
    expect(duplicate.body.fieldErrors).toEqual([
      { field: 'name', message: 'A meter type with this name already exists.' },
    ]);
    // The same name may be both an owner and a hire company.
    await org.admin
      .post('/config/plant-companies', { kind: 'owner', name: 'Both Ways' })
      .expect(201);
    await org.admin
      .post('/config/plant-companies', {
        kind: 'hire_company',
        name: 'Both Ways',
      })
      .expect(201);
  });

  it('validates custom fields: choices for choice lists only, type fixed', async () => {
    const noChoices = await org.admin
      .post('/config/custom-fields', { label: 'Fuel', fieldType: 'select' })
      .expect(400);
    expect(noChoices.body.fieldErrors).toEqual([
      { field: 'options', message: 'Add at least one choice.' },
    ]);
    await org.admin
      .post('/config/custom-fields', {
        label: 'Fuel',
        fieldType: 'select',
        options: ['Diesel', 'diesel'],
      })
      .expect(400);

    const fuel = (
      await org.admin
        .post('/config/custom-fields', {
          label: 'Fuel',
          fieldType: 'select',
          options: ['Diesel', 'Electric'],
        })
        .expect(201)
    ).body as CustomField;
    expect(fuel.options).toEqual(['Diesel', 'Electric']);
    await org.admin
      .patch(`/config/custom-fields/${fuel.id}`, { options: [] })
      .expect(400);

    // Choices sent for a text field are dropped on create, refused on edit.
    const notes = (
      await org.admin
        .post('/config/custom-fields', {
          label: 'Notes',
          fieldType: 'text',
          options: ['ignored'],
        })
        .expect(201)
    ).body as CustomField;
    expect(notes.options).toEqual([]);
    await org.admin
      .patch(`/config/custom-fields/${notes.id}`, { options: ['x'] })
      .expect(400);
    const sameType = (
      await org.admin
        .patch(`/config/custom-fields/${notes.id}`, { fieldType: 'number' })
        .expect(200)
    ).body as CustomField;
    expect(sameType.fieldType).toBe('text');
  });

  it('bounds the expiry warning of a document type (DOC-005)', async () => {
    const tooLong = await org.admin
      .post('/config/document-types', { name: 'PUWER', warningDays: 400 })
      .expect(400);
    expect(tooLong.body.fieldErrors[0].field).toBe('warningDays');
    const puwer = (
      await org.admin
        .post('/config/document-types', { name: 'PUWER' })
        .expect(201)
    ).body as DocumentType;
    expect(puwer).toMatchObject({ hasExpiry: true, warningDays: 30 });
  });

  it('sets the mandatory documents of a plant type (DOC-001)', async () => {
    const type = (
      await org.admin.post('/config/plant-types', { name: 'Crane' }).expect(201)
    ).body as PlantType;
    const insurance = (
      await org.admin
        .post('/config/document-types', { name: 'Insurance' })
        .expect(201)
    ).body as DocumentType;
    const thorough = (
      await org.admin
        .post('/config/document-types', { name: 'Thorough examination' })
        .expect(201)
    ).body as DocumentType;

    const set = (
      await org.admin
        .put(`/config/plant-types/${type.id}/required-documents`, {
          documentTypeIds: [insurance.id, thorough.id],
        })
        .expect(200)
    ).body as PlantType;
    expect(set.requiredDocumentTypeIds.sort()).toEqual(
      [insurance.id, thorough.id].sort(),
    );

    // An archived document type cannot be newly made mandatory...
    await org.admin
      .post(`/config/document-types/${insurance.id}/archive`)
      .expect(200);
    const reduced = (
      await org.admin
        .put(`/config/plant-types/${type.id}/required-documents`, {
          documentTypeIds: [thorough.id],
        })
        .expect(200)
    ).body as PlantType;
    expect(reduced.requiredDocumentTypeIds).toEqual([thorough.id]);
    const refused = await org.admin
      .put(`/config/plant-types/${type.id}/required-documents`, {
        documentTypeIds: [thorough.id, insurance.id],
      })
      .expect(400);
    expect(refused.body.fieldErrors[0].message).toMatch(/archived/);

    const listed = (
      (await org.admin.get('/config/plant-types').expect(200))
        .body as PlantType[]
    ).find((candidate) => candidate.id === type.id);
    expect(listed?.requiredDocumentTypeIds).toEqual([thorough.id]);

    const audit = (
      await org.admin.get('/audit-events?category=plant_type').expect(200)
    ).body as Paginated<AuditEvent>;
    const change = audit.items.find(
      (event) => event.action === 'plant_type.requirements_changed',
    );
    expect(change?.after).toEqual({ documents: ['Thorough examination'] });
  });

  it('lets everyone read the lists but only Admins change them', async () => {
    const siteId = await createSite(org.admin);
    const operative = await createActiveUser(t, org.admin, {
      firstName: 'Conf',
      lastName: 'Operative',
      roleId: org.roleIds.operative,
      siteIds: [siteId],
    });
    const manager = await createActiveUser(t, org.admin, {
      firstName: 'Conf',
      lastName: 'Manager',
      roleId: org.roleIds.manager,
      siteIds: [siteId],
    });
    for (const kind of [
      'plant-types',
      'plant-companies',
      'meter-types',
      'document-types',
      'custom-fields',
    ]) {
      await operative.client.get(`/config/${kind}`).expect(200);
    }
    await manager.client
      .post('/config/plant-types', { name: 'Not allowed' })
      .expect(403);
    await manager.client
      .post('/config/meter-types', { name: 'Odometer', unit: 'km' })
      .expect(403);
    await manager.client
      .post('/config/document-types', { name: 'Nope' })
      .expect(403);
    const type = (
      (await org.admin.get('/config/plant-types').expect(200))
        .body as PlantType[]
    )[0]!;
    await manager.client
      .put(`/config/plant-types/${type.id}/required-documents`, {
        documentTypeIds: [],
      })
      .expect(403);
  });

  it('keeps each organisation’s configuration to itself', async () => {
    const other = await setUpOrganisation(t, staff);
    const mine = (
      await org.admin
        .post('/config/meter-types', { name: 'Private meter', unit: 'x' })
        .expect(201)
    ).body as MeterType;
    const theirs = (await other.admin.get('/config/meter-types').expect(200))
      .body as MeterType[];
    expect(theirs.map((item) => item.id)).not.toContain(mine.id);
    await other.admin
      .patch(`/config/meter-types/${mine.id}`, { unit: 'stolen' })
      .expect(404);
    await other.admin
      .post(`/config/meter-types/${mine.id}/archive`)
      .expect(404);
    // The other organisation may use the same name for its own list.
    await other.admin
      .post('/config/meter-types', { name: 'Private meter', unit: 'x' })
      .expect(201);
  });

  it('answers unknown lists and ids as not found', async () => {
    await org.admin.get('/config/widgets').expect(404);
    await org.admin.patch('/config/plant-types/not-a-uuid', {}).expect(404);
  });
});
