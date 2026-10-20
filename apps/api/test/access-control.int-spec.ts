import type supertest from 'supertest';
import {
  type AuditEvent,
  type Paginated,
  PERMISSION_CODES,
  type RoleSummary,
  type UserDetail,
  type UserSummary,
  type UserWithCredentials,
} from '@corecheck/shared';
import {
  ApiClient,
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
type ActiveUser = Awaited<ReturnType<typeof createActiveUser>>;

describe('Permissions and record scope (FRD 3.2, 4, Appendix C)', () => {
  let t: TestApp;
  let staff: Agent;
  let org: OrganisationFixture;
  let leeds: string;
  let york: string;
  let lifting: string;
  let roads: string;
  let manager: ActiveUser;
  let supervisor: ActiveUser;
  let liftingOperative: ActiveUser;
  let yorkOperative: ActiveUser;
  let leedsTechnician: ActiveUser;

  const usernames = async (client: ApiClient) =>
    (
      (await client.get('/users?pageSize=100').expect(200))
        .body as Paginated<UserSummary>
    ).items.map((user) => user.id);

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff, { seatLimit: 50 });
    leeds = await createSite(org.admin, 'Leeds');
    york = await createSite(org.admin, 'York');
    lifting = await createTeam(org.admin, 'Lifting');
    roads = await createTeam(org.admin, 'Roads');

    const make = (
      lastName: string,
      role: keyof typeof org.roleIds,
      siteIds: string[],
      teamIds: string[] = [],
    ) =>
      createActiveUser(t, org.admin, {
        firstName: 'Test',
        lastName,
        roleId: org.roleIds[role],
        siteIds,
        teamIds,
      });
    manager = await make('Manager', 'manager', [leeds]);
    supervisor = await make('Supervisor', 'supervisor', [leeds], [lifting]);
    liftingOperative = await make('Lifter', 'operative', [leeds], [lifting]);
    yorkOperative = await make('Yorker', 'operative', [york], [roads]);
    leedsTechnician = await make('Tech', 'technician', [leeds]);
  });
  afterAll(() => t.close());

  it('refuses actions the role does not hold, at the API (ROL-AC-01)', async () => {
    const operative = liftingOperative.client;
    await operative.get('/users').expect(403);
    await operative.post('/sites', { name: 'Nope' }).expect(403);
    await operative
      .post('/roles', { name: 'Nope', permissions: [] })
      .expect(403);
    await operative.get('/audit-events').expect(403);
    await operative.get('/roles').expect(403);
    await leedsTechnician.client
      .post('/users', {
        firstName: 'A',
        lastName: 'B',
        roleId: org.roleIds.operative,
      })
      .expect(403);
    await manager.client.get('/audit-events').expect(403);
    // What they may do still works.
    await operative.get('/sites').expect(200);
  });

  it('shows a Manager only users in the Manager’s sites (ROL-AC-02, SCP-004)', async () => {
    const visible = await usernames(manager.client);
    expect(visible).toEqual(
      expect.arrayContaining([
        manager.id,
        supervisor.id,
        liftingOperative.id,
        leedsTechnician.id,
      ]),
    );
    expect(visible).not.toContain(yorkOperative.id);
    await manager.client.get(`/users/${yorkOperative.id}`).expect(404);
  });

  it('shows a Supervisor only users in the Supervisor’s teams', async () => {
    const visible = await usernames(supervisor.client);
    expect(visible).toEqual(
      expect.arrayContaining([supervisor.id, liftingOperative.id]),
    );
    expect(visible).not.toContain(leedsTechnician.id);
    expect(visible).not.toContain(manager.id);
  });

  it('shows sites by assignment unless the role is organisation-wide', async () => {
    const managerSites = (await manager.client.get('/sites').expect(200))
      .body as Array<{ id: string }>;
    expect(managerSites.map((s) => s.id)).toEqual([leeds]);
    const adminSites = (await org.admin.get('/sites').expect(200))
      .body as Array<{ id: string }>;
    expect(adminSites.map((s) => s.id).sort()).toEqual([leeds, york].sort());
  });

  it('lets a Manager create non-privileged users only within the Manager’s sites (ROL-005)', async () => {
    await manager.client
      .post('/users', {
        firstName: 'New',
        lastName: 'Operative',
        roleId: org.roleIds.operative,
        siteIds: [leeds],
      })
      .expect(201);

    const elsewhere = await manager.client
      .post('/users', {
        firstName: 'New',
        lastName: 'Operative',
        roleId: org.roleIds.operative,
        siteIds: [york],
      })
      .expect(403);
    expect(elsewhere.body.code).toBe('OUT_OF_SCOPE');

    for (const role of ['manager', 'admin'] as const) {
      const privileged = await manager.client
        .post('/users', {
          firstName: 'New',
          lastName: 'Boss',
          roleId: org.roleIds[role],
          siteIds: [leeds],
        })
        .expect(403);
      expect(privileged.body.code).toBe('PRIVILEGED_ROLE');
    }

    const noSite = await manager.client
      .post('/users', {
        firstName: 'New',
        lastName: 'Floater',
        roleId: org.roleIds.operative,
      })
      .expect(400);
    expect(noSite.body.fieldErrors[0].field).toBe('siteIds');
  });

  it('stops a Manager promoting a user to a privileged role or changing their own account', async () => {
    const promote = await manager.client
      .patch(`/users/${liftingOperative.id}`, { roleId: org.roleIds.manager })
      .expect(403);
    expect(promote.body.code).toBe('PRIVILEGED_ROLE');

    const self = await manager.client
      .patch(`/users/${manager.id}`, { siteIds: [leeds, york] })
      .expect(403);
    expect(self.body.code).toBe('SELF_ACTION');

    const peer = await createActiveUser(t, org.admin, {
      firstName: 'Reset',
      lastName: 'Target',
      roleId: org.roleIds.supervisor,
      siteIds: [leeds],
    });
    const reset = await manager.client
      .post(`/users/${peer.id}/reset-pin`)
      .expect(200);
    expect(
      (reset.body as UserWithCredentials).credentials.temporaryPin,
    ).toMatch(/^\d{6}$/);
    // The reset ends the user's session (they must sign in with the new PIN).
    expect((await peer.client.get('/auth/me').expect(401)).body.code).toBe(
      'SESSION_REVOKED',
    );
  });

  it('reports what the caller may do to each user', async () => {
    const asManager = (
      await manager.client.get(`/users/${leedsTechnician.id}`).expect(200)
    ).body as UserDetail;
    expect(asManager.capabilities).toMatchObject({
      canEdit: true,
      canResetPin: true,
      canAssignScope: true,
      canUnlock: false,
      canDeactivate: true,
      canReactivate: false,
    });
    const asSupervisor = (
      await supervisor.client.get(`/users/${liftingOperative.id}`).expect(200)
    ).body as UserDetail;
    expect(
      Object.values(asSupervisor.capabilities).every((allowed) => !allowed),
    ).toBe(true);
  });

  it('applies scope changes at once without changing history (ROL-AC-03, SCP-005, SCP-006)', async () => {
    const mover = await createActiveUser(t, manager.client, {
      firstName: 'Moving',
      lastName: 'Person',
      roleId: org.roleIds.operative,
      siteIds: [leeds],
    });
    await manager.client.get(`/users/${mover.id}`).expect(200);

    await org.admin
      .patch(`/users/${mover.id}`, { siteIds: [york] })
      .expect(200);
    await manager.client.get(`/users/${mover.id}`).expect(404);
    const me = (await mover.client.get('/auth/me').expect(200)).body;
    expect(me.scope.siteIds).toEqual([york]);

    const history = (
      await org.admin
        .get('/audit-events?category=user&pageSize=100')
        .expect(200)
    ).body as Paginated<AuditEvent>;
    const about = history.items.filter((e) => e.entityId === mover.id);
    expect(about.map((e) => e.action)).toEqual(
      expect.arrayContaining(['user.created', 'user.scope.changed']),
    );
    expect(about.find((e) => e.action === 'user.created')!.actorName).toContain(
      'Manager',
    );
    const change = about.find((e) => e.action === 'user.scope.changed')!;
    expect(change.before).toMatchObject({ sites: ['Leeds'] });
    expect(change.after).toMatchObject({ sites: ['York'] });
  });

  it('lets an Admin build a read-only Viewer role with no developer help (ROL-002, ROL-AC-04)', async () => {
    const viewerPermissions = PERMISSION_CODES.filter((code) =>
      code.endsWith('.view'),
    );
    const viewer = (
      await org.admin
        .post('/roles', {
          name: 'Viewer',
          description: 'Read only',
          permissions: viewerPermissions,
        })
        .expect(201)
    ).body as RoleSummary;
    expect(viewer).toMatchObject({ isStandard: false, privileged: false });

    const person = await createActiveUser(t, org.admin, {
      firstName: 'Vera',
      lastName: 'Viewer',
      roleId: viewer.id,
      siteIds: [leeds],
    });
    await person.client.get('/sites').expect(200);
    await person.client.get('/users').expect(200);
    await person.client.post('/sites', { name: 'Not allowed' }).expect(403);
    await person.client
      .post('/users', { firstName: 'A', lastName: 'B', roleId: viewer.id })
      .expect(403);

    // A Manager may give out the non-privileged Viewer role.
    await manager.client
      .post('/users', {
        firstName: 'Vic',
        lastName: 'Viewer',
        roleId: viewer.id,
        siteIds: [leeds],
      })
      .expect(201);
  });

  it('applies role permission changes to holders immediately', async () => {
    const role = (
      await org.admin
        .post('/roles', { name: 'Site reader', permissions: [] })
        .expect(201)
    ).body as RoleSummary;
    const holder = await createActiveUser(t, org.admin, {
      firstName: 'Rita',
      lastName: 'Reader',
      roleId: role.id,
      siteIds: [leeds],
    });
    await holder.client.get('/sites').expect(403);
    await org.admin
      .patch(`/roles/${role.id}`, { permissions: ['org_structure.view'] })
      .expect(200);
    await holder.client.get('/sites').expect(200);

    const history = (
      await org.admin.get('/audit-events?category=role&pageSize=50').expect(200)
    ).body as Paginated<AuditEvent>;
    const update = history.items.find(
      (e) => e.entityId === role.id && e.action === 'role.updated',
    )!;
    expect(update.after).toMatchObject({
      permissionsAdded: ['org_structure.view'],
    });
  });

  it('treats a custom role with user management as privileged (ROL-004)', async () => {
    const role = (
      await org.admin
        .post('/roles', {
          name: 'Shift lead',
          permissions: ['users.view', 'users.manage'],
        })
        .expect(201)
    ).body as RoleSummary;
    expect(role.privileged).toBe(true);
    const refused = await manager.client
      .post('/users', {
        firstName: 'Shift',
        lastName: 'Lead',
        roleId: role.id,
        siteIds: [leeds],
      })
      .expect(403);
    expect(refused.body.code).toBe('PRIVILEGED_ROLE');
  });

  it('protects standard roles and validates custom ones', async () => {
    const locked = await org.admin
      .patch(`/roles/${org.roleIds.operative}`, { name: 'Renamed' })
      .expect(403);
    expect(locked.body.code).toBe('STANDARD_ROLE_LOCKED');
    await org.admin.post(`/roles/${org.roleIds.manager}/archive`).expect(403);

    const copy = (
      await org.admin
        .post(`/roles/${org.roleIds.supervisor}/duplicate`, {
          name: 'Senior supervisor',
        })
        .expect(201)
    ).body as RoleSummary;
    const original = (
      await org.admin.get(`/roles/${org.roleIds.supervisor}`).expect(200)
    ).body as RoleSummary;
    expect(copy.permissions).toEqual(original.permissions);
    expect(copy.isStandard).toBe(false);

    await org.admin
      .post('/roles', { name: 'Bad', permissions: ['admin.everything'] })
      .expect(400);
    const duplicate = await org.admin
      .post('/roles', { name: 'senior SUPERVISOR', permissions: [] })
      .expect(409);
    expect(duplicate.body.message).toBe(
      'A role with this name already exists.',
    );
  });

  it('will not archive a role that active users hold', async () => {
    const role = (
      await org.admin
        .post('/roles', { name: 'Temporary', permissions: [] })
        .expect(201)
    ).body as RoleSummary;
    const holder = await createActiveUser(t, org.admin, {
      firstName: 'Tem',
      lastName: 'Porary',
      roleId: role.id,
      siteIds: [leeds],
    });
    expect(
      (await org.admin.post(`/roles/${role.id}/archive`).expect(409)).body.code,
    ).toBe('ROLE_IN_USE');

    await org.admin.post(`/users/${holder.id}/deactivate`).expect(200);
    await org.admin.post(`/roles/${role.id}/archive`).expect(200);
    const assign = await org.admin
      .post('/users', {
        firstName: 'X',
        lastName: 'Y',
        roleId: role.id,
        siteIds: [leeds],
      })
      .expect(400);
    expect(assign.body.fieldErrors[0].field).toBe('roleId');
  });

  it('never lets an Admin lock themselves out', async () => {
    const adminMe = (await org.admin.get('/auth/me').expect(200)).body;
    const self = await org.admin
      .post(`/users/${adminMe.user.id}/deactivate`)
      .expect(403);
    expect(self.body.code).toBe('SELF_ACTION');
  });
});
