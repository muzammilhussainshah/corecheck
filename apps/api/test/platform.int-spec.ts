import supertest from 'supertest';
import type {
  AuditEvent,
  CreateOrganisationResponse,
  Discipline,
  IssuedCredentials,
  MfaSetupResponse,
  OrganisationAdmin,
  OrganisationDetail,
  Paginated,
  RoleSummary,
  StaffLoginResponse,
  StaffWithPassword,
} from '@corecheck/shared';
import { addDays, dateInTimeZone } from '../src/common/clock.js';
import {
  activate,
  createStaffAccount,
  organisationInput,
  setUpOrganisation,
  signIn,
  type StaffAccount,
  staffSession,
  totp,
  uid,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

type Agent = ReturnType<typeof supertest.agent>;

describe('Internal CoreCheck administration (FRD 23)', () => {
  let t: TestApp;
  let ownerAccount: StaffAccount;
  let owner: Agent;

  beforeAll(async () => {
    t = await createTestApp();
    ownerAccount = await createStaffAccount(t, 'owner');
    owner = await staffSession(t, ownerAccount);
  });
  afterAll(() => t.close());
  afterEach(() => t.clock.reset());

  describe('staff sign-in', () => {
    it('requires the second factor before any portal access', async () => {
      const agent = supertest.agent(t.server);
      const login = await agent
        .post('/platform/auth/login')
        .send({ email: ownerAccount.email, password: ownerAccount.password })
        .expect(200);
      expect((login.body as StaffLoginResponse).next).toBe('mfa_verify');
      expect(
        (await agent.get('/platform/organisations').expect(403)).body.code,
      ).toBe('MFA_REQUIRED');

      const wrong = await agent
        .post('/platform/auth/mfa/verify')
        .send({ code: '000000' })
        .expect(400);
      expect(wrong.body.code).toBe('INVALID_MFA_CODE');
      await agent
        .post('/platform/auth/mfa/verify')
        .send({ code: await totp(ownerAccount.secret) })
        .expect(200);
      await agent.get('/platform/organisations').expect(200);
    });

    it('takes a new staff member through MFA enrolment and a password change', async () => {
      const email = `new.${uid()}@corecheck.test`;
      const created = (
        await owner
          .post('/platform/staff')
          .send({ name: 'New Support', email, staffRole: 'support' })
          .expect(201)
      ).body as StaffWithPassword;
      expect(created.temporaryPassword).toHaveLength(16);

      const agent = supertest.agent(t.server);
      const login = await agent
        .post('/platform/auth/login')
        .send({ email, password: created.temporaryPassword })
        .expect(200);
      expect((login.body as StaffLoginResponse).next).toBe('mfa_setup');
      expect(
        (await agent.get('/platform/organisations').expect(403)).body.code,
      ).toBe('MFA_SETUP_REQUIRED');

      const setup = (await agent.post('/platform/auth/mfa/setup').expect(200))
        .body as MfaSetupResponse;
      expect(setup.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(setup.otpauthUrl).toContain('CoreCheck');
      await agent
        .post('/platform/auth/mfa/confirm')
        .send({ code: await totp(setup.secret) })
        .expect(200);

      expect(
        (await agent.get('/platform/organisations').expect(403)).body.code,
      ).toBe('PASSWORD_CHANGE_REQUIRED');
      await agent
        .post('/platform/auth/change-password')
        .send({
          currentPassword: created.temporaryPassword,
          newPassword: 'short',
        })
        .expect(400);
      await agent
        .post('/platform/auth/change-password')
        .send({
          currentPassword: created.temporaryPassword,
          newPassword: 'A-much-better-passphrase',
        })
        .expect(200);
      await agent.get('/platform/organisations').expect(200);
    });

    it('locks a staff account after five failed attempts', async () => {
      const account = await createStaffAccount(t, 'admin');
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await t.http
          .post('/platform/auth/login')
          .send({ email: account.email, password: 'wrong-password' })
          .expect(401);
      }
      const locked = await t.http
        .post('/platform/auth/login')
        .send({ email: account.email, password: 'wrong-password' })
        .expect(403);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
      await t.http
        .post('/platform/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(403);

      const reset = (
        await owner
          .post(`/platform/staff/${account.id}/reset-credentials`)
          .send({})
          .expect(200)
      ).body as StaffWithPassword;
      expect(reset.staff.locked).toBe(false);
      await t.http
        .post('/platform/auth/login')
        .send({ email: account.email, password: reset.temporaryPassword })
        .expect(200);
    });

    it('limits each internal rank (support views; admin provisions; owner manages staff)', async () => {
      const support = await staffSession(
        t,
        await createStaffAccount(t, 'support'),
      );
      await support.get('/platform/organisations').expect(200);
      await support.get('/platform/audit-events').expect(200);
      await support
        .post('/platform/organisations')
        .send(organisationInput())
        .expect(403);
      await support.get('/platform/staff').expect(403);

      const admin = await staffSession(t, await createStaffAccount(t, 'admin'));
      await admin
        .post('/platform/organisations')
        .send(organisationInput())
        .expect(201);
      await admin.get('/platform/staff').expect(403);
    });

    it('keeps at least one active owner and stops self-disabling', async () => {
      const self = await owner
        .post(`/platform/staff/${ownerAccount.id}/disable`)
        .expect(403);
      expect(self.body.code).toBe('SELF_ACTION');
    });
  });

  describe('organisation provisioning', () => {
    it('creates an isolated organisation with standard roles, disciplines and the first Admin (IAD-AC-01)', async () => {
      const input = organisationInput({ seatLimit: 7 });
      const created = (
        await owner.post('/platform/organisations').send(input).expect(201)
      ).body as CreateOrganisationResponse;
      expect(created.organisation).toMatchObject({
        name: input.name,
        status: 'active',
        seatLimit: 7,
        seatsUsed: 1,
        timeZone: 'Europe/London',
        expired: false,
      });
      expect(created.firstAdmin.username).toBe(created.credentials.username);

      const { client } = await activate(t, created.credentials);
      const roles = (await client.get('/roles').expect(200))
        .body as RoleSummary[];
      expect(roles.map((role) => role.standardKey)).toEqual([
        'operative',
        'technician',
        'supervisor',
        'manager',
        'admin',
      ]);
      const disciplines = (await client.get('/disciplines').expect(200))
        .body as Discipline[];
      expect(disciplines.map((d) => d.name)).toEqual([
        'Communications',
        'Electrical',
        'Mechanical',
        'Specialist',
      ]);

      const admins = (
        await owner
          .get(`/platform/organisations/${created.organisation.id}/admins`)
          .expect(200)
      ).body as OrganisationAdmin[];
      expect(admins).toHaveLength(1);
    });

    it('validates provisioning input and rejects duplicate names', async () => {
      const bad = await owner
        .post('/platform/organisations')
        .send({
          ...organisationInput({
            startsOn: '2026-05-01',
            expiresOn: '2026-04-01',
          }),
          timeZone: 'Mars/Base',
        })
        .expect(400);
      expect(
        bad.body.fieldErrors.map((e: { field: string }) => e.field),
      ).toEqual(expect.arrayContaining(['expiresOn', 'timeZone']));

      const input = organisationInput();
      await owner.post('/platform/organisations').send(input).expect(201);
      const duplicate = await owner
        .post('/platform/organisations')
        .send({ ...organisationInput(), name: input.name.toUpperCase() })
        .expect(409);
      expect(duplicate.body.message).toBe(
        'An organisation with this name already exists.',
      );
    });

    it('suspends an organisation: sign-in stops and live sessions end (IAD-008, IAD-AC-03)', async () => {
      const org = await setUpOrganisation(t, owner);
      await owner
        .post(`/platform/organisations/${org.orgId}/suspend`)
        .send({ reason: 'Unpaid invoice' })
        .expect(200);

      expect((await org.admin.get('/auth/me').expect(401)).body.code).toBe(
        'ORG_SUSPENDED',
      );
      const login = await t.http
        .post('/auth/login')
        .send({ username: org.adminUsername, pin: '258147', client: 'mobile' });
      expect(login.status).toBe(403);
      expect(login.body.code).toBe('ORG_SUSPENDED');

      await owner
        .post(`/platform/organisations/${org.orgId}/suspend`)
        .send({})
        .expect(409);
      const reactivated = (
        await owner
          .post(`/platform/organisations/${org.orgId}/activate`)
          .send({})
          .expect(200)
      ).body as OrganisationDetail;
      expect(reactivated.status).toBe('active');

      const history = (
        await owner
          .get('/platform/audit-events?category=organisation&pageSize=100')
          .expect(200)
      ).body as Paginated<AuditEvent>;
      const suspension = history.items.find(
        (e) =>
          e.entityId === org.orgId && e.action === 'organisation.suspended',
      )!;
      expect(suspension.summary).toContain('Unpaid invoice');
    });

    it('makes an expired organisation read-only but still viewable (IAD-007, IAD-AC-03)', async () => {
      const org = await setUpOrganisation(t, owner);
      const yesterday = dateInTimeZone(
        addDays(new Date(), -1),
        'Europe/London',
      );
      const twoDaysAgo = dateInTimeZone(
        addDays(new Date(), -2),
        'Europe/London',
      );
      const updated = (
        await owner
          .patch(`/platform/organisations/${org.orgId}`)
          .send({ startsOn: twoDaysAgo, expiresOn: yesterday })
          .expect(200)
      ).body as OrganisationDetail;
      expect(updated.expired).toBe(true);

      const me = (await org.admin.get('/auth/me').expect(200)).body;
      expect(me.organisation.readOnly).toBe(true);
      await org.admin.get('/users').expect(200);
      expect(
        (await org.admin.post('/sites', { name: 'Blocked' }).expect(403)).body
          .code,
      ).toBe('ORG_READ_ONLY');
      await org.admin.post('/auth/logout').expect(204);
    });

    it('blocks sign-in before the account start date', async () => {
      const created = (
        await owner
          .post('/platform/organisations')
          .send(
            organisationInput({
              startsOn: dateInTimeZone(
                addDays(new Date(), 10),
                'Europe/London',
              ),
              expiresOn: dateInTimeZone(
                addDays(new Date(), 400),
                'Europe/London',
              ),
            }),
          )
          .expect(201)
      ).body as CreateOrganisationResponse;
      const login = await t.http
        .post('/auth/login')
        .send({
          username: created.credentials.username,
          pin: created.credentials.temporaryPin,
          client: 'mobile',
        })
        .expect(403);
      expect(login.body.code).toBe('ORG_NOT_STARTED');
    });

    it('resets and unlocks the Organisation Admin (IAD-004)', async () => {
      const org = await setUpOrganisation(t, owner);
      const admins = (
        await owner
          .get(`/platform/organisations/${org.orgId}/admins`)
          .expect(200)
      ).body as OrganisationAdmin[];
      const adminId = admins[0]!.id;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await t.http.post('/auth/login').send({
          username: org.adminUsername,
          pin: '999000',
          client: 'mobile',
        });
      }
      const locked = (
        await owner
          .get(`/platform/organisations/${org.orgId}/admins`)
          .expect(200)
      ).body as OrganisationAdmin[];
      expect(locked[0]!.status).toBe('locked');

      await owner
        .post(`/platform/organisations/${org.orgId}/admins/${adminId}/unlock`)
        .expect(200);
      const reset = (
        await owner
          .post(
            `/platform/organisations/${org.orgId}/admins/${adminId}/reset-pin`,
          )
          .expect(200)
      ).body as { credentials: IssuedCredentials };
      const token = await signIn(
        t,
        org.adminUsername,
        reset.credentials.temporaryPin,
      );
      expect(token).toEqual(expect.any(String));

      // The customer can see that CoreCheck reset their Admin's PIN.
      const { client } = await activate(t, reset.credentials);
      const events = (
        await client.get('/audit-events?category=user').expect(200)
      ).body as Paginated<AuditEvent>;
      expect(
        events.items.some(
          (e) => e.action === 'user.pin.reset' && e.actorType === 'staff',
        ),
      ).toBe(true);
    });

    it('gives staff no way into customer workspaces (IAD-011, IAD-AC-04)', async () => {
      // Staff cookies are not customer sessions.
      await owner.get('/users').expect(401);
      await owner.get('/sites').expect(401);
      await owner.get('/audit-events').expect(401);
      // Nor do customer sessions open the portal.
      const org = await setUpOrganisation(t, owner);
      await org.admin.get('/platform/organisations').expect(401);
    });

    it('lists organisations with search, status filter and usage', async () => {
      const marker = uid();
      const org = await setUpOrganisation(t, owner, {
        name: `Findable ${marker}`,
      });
      await owner
        .post(`/platform/organisations/${org.orgId}/archive`)
        .send({})
        .expect(200);
      const page = (
        await owner
          .get(`/platform/organisations?search=${marker}&status=archived`)
          .expect(200)
      ).body as Paginated<OrganisationDetail>;
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({
        id: org.orgId,
        status: 'archived',
        seatsUsed: 1,
      });
    });

    it('shows storage usage as totals only (IAD-004)', async () => {
      const org = await setUpOrganisation(t, owner);
      const detail = async () =>
        (await owner.get(`/platform/organisations/${org.orgId}`).expect(200))
          .body as OrganisationDetail;
      expect((await detail()).usage).toMatchObject({
        storedFiles: 0,
        storageBytes: 0,
      });

      const [{ id: userId }] = (await t.dataSource.query(
        'select id from corecheck.users where username = $1',
        [org.adminUsername],
      )) as { id: string }[];
      const [{ id: siteId }] = (await t.dataSource.query(
        `insert into corecheck.sites (org_id, name) values ($1, 'Storage site') returning id`,
        [org.orgId],
      )) as { id: string }[];
      const [{ id: checkId }] = (await t.dataSource.query(
        `insert into corecheck.poc_checks (org_id, site_id, title, plant_label)
         values ($1, $2, 'Check', 'P-1') returning id`,
        [org.orgId, siteId],
      )) as { id: string }[];
      for (const size of [1500, 2500]) {
        await t.dataSource.query(
          `insert into corecheck.poc_evidence
             (id, org_id, check_id, question_key, storage_path, content_type,
              size_bytes, uploaded_by, captured_at)
           values (gen_random_uuid(), $1, $2, 'photo', 'x', 'image/jpeg', $3, $4, now())`,
          [org.orgId, checkId, size, userId],
        );
      }
      expect((await detail()).usage).toMatchObject({
        storedFiles: 2,
        storageBytes: 4000,
      });
    });
  });
});

describe('Staff sign-in with MFA switched off (STAFF_MFA_REQUIRED=false)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ staffMfaRequired: false });
  });
  afterAll(() => t.close());

  it('opens the portal with email and password alone', async () => {
    const account = await createStaffAccount(t, 'owner');
    const agent = supertest.agent(t.server);
    const login = await agent
      .post('/platform/auth/login')
      .send({ email: account.email, password: account.password })
      .expect(200);
    const body = login.body as StaffLoginResponse;
    expect(body.next).toBe('done');
    expect(body.staff.mfaVerified).toBe(true);
    await agent.get('/platform/organisations').expect(200);
  });

  it('still rejects a wrong password and locks after repeated failures', async () => {
    const account = await createStaffAccount(t, 'support');
    const agent = supertest.agent(t.server);
    for (let attempt = 0; attempt < 5; attempt++) {
      await agent
        .post('/platform/auth/login')
        .send({ email: account.email, password: 'not-the-password-123' })
        .expect((res) => expect([401, 403]).toContain(res.status));
    }
    const locked = await agent
      .post('/platform/auth/login')
      .send({ email: account.email, password: account.password })
      .expect(403);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });
});
