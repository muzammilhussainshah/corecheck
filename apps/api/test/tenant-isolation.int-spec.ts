import type supertest from 'supertest';
import { QueryFailedError } from 'typeorm';
import type {
  Paginated,
  RoleSummary,
  Site,
  Team,
  UserSummary,
} from '@corecheck/shared';
import { enterTenantRole } from '../src/database/db-context.js';
import {
  createActiveUser,
  createSite,
  createStaffAccount,
  createTeam,
  type OrganisationFixture,
  setUpOrganisation,
  staffSession,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

type Agent = ReturnType<typeof supertest.agent>;

const pgCode = (error: unknown): string | undefined =>
  error instanceof QueryFailedError
    ? (error.driverError as { code?: string }).code
    : undefined;

describe('Tenant isolation (TEN-002, TEN-004, NFR-001)', () => {
  let t: TestApp;
  let staff: Agent;
  let a: OrganisationFixture;
  let b: OrganisationFixture;
  let bSite: string;
  let bTeam: string;
  let bUser: { id: string };
  let bCustomRole: string;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
    [a, b] = [
      await setUpOrganisation(t, staff),
      await setUpOrganisation(t, staff),
    ];

    await createSite(a.admin, 'Shared Name Site');
    bSite = await createSite(b.admin, 'Shared Name Site');
    bTeam = await createTeam(b.admin);
    bUser = await createActiveUser(t, b.admin, {
      firstName: 'Bea',
      lastName: 'Bravo',
      roleId: b.roleIds.operative,
      siteIds: [bSite],
    });
    bCustomRole = (
      (
        await b.admin
          .post('/roles', { name: 'B viewer', permissions: ['plant.view'] })
          .expect(201)
      ).body as RoleSummary
    ).id;
  });
  afterAll(() => t.close());

  it('lists only the organisation’s own records', async () => {
    const users = (await a.admin.get('/users?pageSize=100').expect(200))
      .body as Paginated<UserSummary>;
    expect(users.items.map((u) => u.id)).not.toContain(bUser.id);
    expect(users.total).toBe(1);

    const roles = (await a.admin.get('/roles').expect(200))
      .body as RoleSummary[];
    expect(roles.map((r) => r.id)).not.toContain(bCustomRole);
    expect(roles).toHaveLength(5);

    const sites = (await a.admin.get('/sites').expect(200)).body as Site[];
    expect(sites.map((s) => s.id)).not.toContain(bSite);
    const teams = (await a.admin.get('/teams').expect(200)).body as Team[];
    expect(teams.map((team) => team.id)).not.toContain(bTeam);
  });

  it('answers "not found" for another organisation’s records, revealing nothing', async () => {
    await a.admin.get(`/users/${bUser.id}`).expect(404);
    await a.admin
      .patch(`/users/${bUser.id}`, { firstName: 'Hacked' })
      .expect(404);
    await a.admin.post(`/users/${bUser.id}/reset-pin`).expect(404);
    await a.admin.post(`/users/${bUser.id}/deactivate`).expect(404);
    await a.admin.get(`/roles/${bCustomRole}`).expect(404);
    await a.admin
      .patch(`/roles/${bCustomRole}`, { name: 'Hacked' })
      .expect(404);
    await a.admin.patch(`/sites/${bSite}`, { name: 'Hacked' }).expect(404);
    await a.admin.post(`/sites/${bSite}/archive`).expect(404);
    await a.admin.get(`/sites/${bSite}/areas`).expect(404);
    await a.admin.patch(`/teams/${bTeam}`, { name: 'Hacked' }).expect(404);

    // B's data is untouched.
    const user = (await b.admin.get(`/users/${bUser.id}`).expect(200))
      .body as UserSummary;
    expect(user.firstName).toBe('Bea');
  });

  it('refuses to link another organisation’s roles, sites or teams', async () => {
    const withForeignRole = await a.admin
      .post('/users', { firstName: 'X', lastName: 'Ray', roleId: bCustomRole })
      .expect(400);
    expect(withForeignRole.body.fieldErrors[0].field).toBe('roleId');

    const withForeignSite = await a.admin
      .post('/users', {
        firstName: 'X',
        lastName: 'Ray',
        roleId: a.roleIds.operative,
        siteIds: [bSite],
      })
      .expect(400);
    expect(withForeignSite.body.fieldErrors[0].field).toBe('siteIds');

    await a.admin
      .post('/users', {
        firstName: 'X',
        lastName: 'Ray',
        roleId: a.roleIds.operative,
        teamIds: [bTeam],
      })
      .expect(400);
  });

  it('enforces isolation inside the database with row-level security', async () => {
    await t.dataSource.transaction(async (manager) => {
      await enterTenantRole(
        manager,
        a.orgId,
        '00000000-0000-0000-0000-000000000000',
      );

      const [{ visible }] = await manager.query(
        'select count(*)::int as visible from corecheck.users where org_id = $1',
        [b.orgId],
      );
      expect(visible).toBe(0);
      const orgs = await manager.query(
        'select id from corecheck.organisations',
      );
      expect(orgs).toEqual([{ id: a.orgId }]);

      await manager.query('savepoint probe');
      const insert = manager.query(
        `insert into corecheck.sites (org_id, name) values ($1, 'Smuggled')`,
        [b.orgId],
      );
      await expect(insert).rejects.toSatisfy(
        (error) => pgCode(error) === '42501',
      );
      await manager.query('rollback to savepoint probe');

      const updated = await manager.query(
        `update corecheck.sites set name = 'Hacked' where id = $1`,
        [bSite],
      );
      expect(updated[1]).toBe(0);
    });
  });

  it('gives the internal-staff database role no access to customer tables (IAD-011, IAD-AC-04)', async () => {
    for (const table of [
      'users',
      'roles',
      'sites',
      'teams',
      'disciplines',
      'poc_checks',
    ]) {
      await t.dataSource.transaction(async (manager) => {
        await manager.query(
          `select set_config('role', 'corecheck_platform', true)`,
        );
        await expect(
          manager.query(`select * from corecheck.${table} limit 1`),
        ).rejects.toSatisfy((error) => pgCode(error) === '42501');
      });
    }
  });

  it('keeps usernames unique across organisations (USR-AC-01)', async () => {
    const usernames = new Set<string>();
    for (const org of [a, b]) {
      for (let i = 0; i < 3; i += 1) {
        const created = await org.admin
          .post('/users', {
            firstName: 'Sam',
            lastName: 'Same',
            roleId: org.roleIds.admin,
          })
          .expect(201);
        usernames.add(created.body.credentials.username);
      }
    }
    expect(usernames.size).toBe(6);
    for (const username of usernames)
      expect(username).toMatch(/^samsame\d{2,3}$/);
  });
});
