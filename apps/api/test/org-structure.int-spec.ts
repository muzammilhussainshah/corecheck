import type supertest from 'supertest';
import type {
  Area,
  Discipline,
  Site,
  Team,
  UserDetail,
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

describe('Sites, areas, teams and disciplines (FRD 15)', () => {
  let t: TestApp;
  let staff: Agent;
  let org: OrganisationFixture;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff);
  });
  afterAll(() => t.close());

  it('creates, renames, archives and restores sites and their areas (ORG-001, ORG-002)', async () => {
    const site = (
      await org.admin
        .post('/sites', { name: 'Leeds', code: 'LDS', address: '' })
        .expect(201)
    ).body as Site;
    expect(site).toMatchObject({
      name: 'Leeds',
      code: 'LDS',
      address: null,
      areaCount: 0,
      archivedAt: null,
    });

    const area = (
      await org.admin
        .post(`/sites/${site.id}/areas`, { name: 'Yard A' })
        .expect(201)
    ).body as Area;
    await org.admin.patch(`/areas/${area.id}`, { name: 'Yard B' }).expect(200);
    const areas = (await org.admin.get(`/sites/${site.id}/areas`).expect(200))
      .body as Area[];
    expect(areas.map((a) => a.name)).toEqual(['Yard B']);

    const renamed = (
      await org.admin
        .patch(`/sites/${site.id}`, { name: 'Leeds Depot', code: '' })
        .expect(200)
    ).body as Site;
    expect(renamed).toMatchObject({
      name: 'Leeds Depot',
      code: null,
      areaCount: 1,
    });

    await org.admin.post(`/sites/${site.id}/archive`).expect(200);
    expect(
      ((await org.admin.get('/sites').expect(200)).body as Site[]).map(
        (s) => s.id,
      ),
    ).not.toContain(site.id);
    expect(
      (
        (await org.admin.get('/sites?includeArchived=true').expect(200))
          .body as Site[]
      ).map((s) => s.id),
    ).toContain(site.id);
    await org.admin
      .post(`/sites/${site.id}/areas`, { name: 'Closed site area' })
      .expect(400);

    const restored = (
      await org.admin.post(`/sites/${site.id}/restore`).expect(200)
    ).body as Site;
    expect(restored.archivedAt).toBeNull();
  });

  it('rejects duplicate names within the organisation', async () => {
    await org.admin.post('/sites', { name: 'Unique Site' }).expect(201);
    const duplicate = await org.admin
      .post('/sites', { name: 'unique site' })
      .expect(409);
    expect(duplicate.body.message).toBe(
      'A site with this name already exists.',
    );
    await org.admin.post('/teams', { name: 'Night shift' }).expect(201);
    await org.admin.post('/teams', { name: 'NIGHT SHIFT' }).expect(409);
  });

  it('starts with the default disciplines and lets Admins add more (ORG-004, ORG-005)', async () => {
    await org.admin.post('/disciplines', { name: 'Hydraulics' }).expect(201);
    const disciplines = (await org.admin.get('/disciplines').expect(200))
      .body as Discipline[];
    expect(disciplines.map((d) => d.name)).toEqual(
      expect.arrayContaining([
        'Mechanical',
        'Electrical',
        'Communications',
        'Specialist',
        'Hydraulics',
      ]),
    );
  });

  it('blocks new assignment of archived items without removing existing ones (ORG-007)', async () => {
    const siteId = await createSite(org.admin);
    const team = (
      await org.admin.post('/teams', { name: 'Archive me' }).expect(201)
    ).body as Team;
    const member = await createActiveUser(t, org.admin, {
      firstName: 'Arch',
      lastName: 'Ived',
      roleId: org.roleIds.operative,
      siteIds: [siteId],
      teamIds: [team.id],
    });

    await org.admin.post(`/teams/${team.id}/archive`).expect(200);
    await org.admin.post(`/sites/${siteId}/archive`).expect(200);

    // Existing assignments survive and can be kept when other fields change.
    const kept = (
      await org.admin
        .patch(`/users/${member.id}`, {
          siteIds: [siteId],
          teamIds: [team.id],
          firstName: 'Archie',
        })
        .expect(200)
    ).body as UserDetail;
    expect(kept.teams.map((t2) => t2.id)).toEqual([team.id]);

    // But they cannot be given to anyone new.
    const refused = await org.admin
      .post('/users', {
        firstName: 'New',
        lastName: 'Person',
        roleId: org.roleIds.operative,
        siteIds: [siteId],
      })
      .expect(400);
    expect(refused.body.fieldErrors[0].message).toMatch(/archived/);
  });

  it('allows only Admins to change the structure', async () => {
    const siteId = await createSite(org.admin);
    const manager = await createActiveUser(t, org.admin, {
      firstName: 'Struct',
      lastName: 'Manager',
      roleId: org.roleIds.manager,
      siteIds: [siteId],
    });
    await manager.client.get('/sites').expect(200);
    await manager.client.get('/teams').expect(200);
    await manager.client
      .post('/sites', { name: 'Not mine to make' })
      .expect(403);
    await manager.client.post(`/sites/${siteId}/archive`).expect(403);
    await manager.client.post('/disciplines', { name: 'Nope' }).expect(403);
  });
});
