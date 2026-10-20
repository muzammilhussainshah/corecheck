import type supertest from 'supertest';
import type {
  AuditEvent,
  CreateOrganisationResponse,
  MeResponse,
  Paginated,
  UserWithCredentials,
} from '@corecheck/shared';
import {
  activate,
  ApiClient,
  createStaffAccount,
  organisationInput,
  type OrganisationFixture,
  setUpOrganisation,
  signIn,
  staffSession,
  uid,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

type Agent = ReturnType<typeof supertest.agent>;

describe('Customer sign-in, PINs and sessions', () => {
  let t: TestApp;
  let staff: Agent;
  let org: OrganisationFixture;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff);
  });
  afterAll(() => t.close());
  afterEach(() => t.clock.reset());

  /** A fresh Operative with a temporary PIN, created by the org Admin. */
  const newOperative = async (): Promise<UserWithCredentials> =>
    (
      await org.admin
        .post('/users', {
          firstName: 'Olu',
          lastName: `Op${uid().replace(/\d/g, '')}`,
          roleId: org.roleIds.operative,
        })
        .expect(201)
    ).body as UserWithCredentials;

  it('lets the first Organisation Admin sign in only to replace the temporary PIN (USR-003, USR-AC-02)', async () => {
    const created = (
      await staff
        .post('/platform/organisations')
        .send(organisationInput())
        .expect(201)
    ).body as CreateOrganisationResponse;
    const { username, temporaryPin } = created.credentials;
    expect(username).toMatch(/^adaadmin\d{2,3}$/);

    const client = new ApiClient(
      t.http,
      await signIn(t, username, temporaryPin),
    );
    expect(
      ((await client.get('/auth/me').expect(200)).body as MeResponse)
        .mustChangePin,
    ).toBe(true);
    expect((await client.get('/users').expect(403)).body.code).toBe(
      'PIN_CHANGE_REQUIRED',
    );

    await client
      .post('/auth/change-pin', { currentPin: temporaryPin, newPin: '123456' })
      .expect(400);
    await client
      .post('/auth/change-pin', { currentPin: temporaryPin, newPin: '111111' })
      .expect(400);
    await client
      .post('/auth/change-pin', {
        currentPin: temporaryPin,
        newPin: temporaryPin,
      })
      .expect(400);
    const me = (
      await client
        .post('/auth/change-pin', {
          currentPin: temporaryPin,
          newPin: '258147',
        })
        .expect(200)
    ).body as MeResponse;
    expect(me.mustChangePin).toBe(false);

    await client.get('/users').expect(200);
    await t.http
      .post('/auth/login')
      .send({ username, pin: temporaryPin, client: 'mobile' })
      .expect(401);
    await signIn(t, username, '258147');
  });

  it('locks the account after five wrong PINs, even against the right one (USR-005)', async () => {
    const created = await newOperative();
    const { client, pin } = await activate(t, created.credentials);
    const { username } = created.credentials;

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await t.http
        .post('/auth/login')
        .send({ username, pin: '999000', client: 'mobile' })
        .expect(401);
      expect(response.body.details.remainingAttempts).toBe(5 - attempt);
    }
    const fifth = await t.http
      .post('/auth/login')
      .send({ username, pin: '999000', client: 'mobile' })
      .expect(403);
    expect(fifth.body.code).toBe('ACCOUNT_LOCKED');

    const right = await t.http
      .post('/auth/login')
      .send({ username, pin, client: 'mobile' })
      .expect(403);
    expect(right.body.code).toBe('ACCOUNT_LOCKED');
    // The live session ended with the lockout.
    expect((await client.get('/auth/me').expect(401)).body.code).toBe(
      'ACCOUNT_LOCKED',
    );

    // An authorised reset issues a new temporary PIN and lifts the lock.
    const reset = (
      await org.admin.post(`/users/${created.user.id}/reset-pin`).expect(200)
    ).body as UserWithCredentials;
    expect(reset.user.status).toBe('active');
    await activate(t, reset.credentials);
  });

  it('allows an Admin to unlock without changing the PIN', async () => {
    const created = await newOperative();
    const { pin } = await activate(t, created.credentials);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await t.http.post('/auth/login').send({
        username: created.credentials.username,
        pin: '999000',
        client: 'mobile',
      });
    }
    await org.admin.post(`/users/${created.user.id}/unlock`).expect(200);
    await signIn(t, created.credentials.username, pin);
    await org.admin.post(`/users/${created.user.id}/unlock`).expect(409);
  });

  it('keeps one active session per user: a new sign-in ends the previous one (USR-006, USR-AC-03)', async () => {
    const created = await newOperative();
    const { client, pin } = await activate(t, created.credentials);

    const web = await t.http
      .post('/auth/login')
      .send({ username: created.credentials.username, pin, client: 'web' })
      .expect(200);
    const replaced = await client.get('/auth/me').expect(401);
    expect(replaced.body.code).toBe('SESSION_REPLACED');

    const cookie = (web.headers['set-cookie'] as unknown as string[]).find(
      (c) => c.startsWith('cc_session='),
    )!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(web.body.token).toBeUndefined();
    await t.http
      .get('/auth/me')
      .set('cookie', cookie.split(';')[0]!)
      .expect(200);
  });

  it('ends a web session after 30 idle minutes, but not a mobile one', async () => {
    const created = await newOperative();
    const { client: mobile, pin } = await activate(t, created.credentials);
    t.clock.advanceMinutes(45);
    await mobile.get('/auth/me').expect(200);
    t.clock.reset();

    const login = await t.http
      .post('/auth/login')
      .send({ username: created.credentials.username, pin, client: 'web' })
      .expect(200);
    const cookie = (
      login.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;

    // Activity keeps the session alive...
    t.clock.advanceMinutes(20);
    await t.http.get('/auth/me').set('cookie', cookie).expect(200);
    // ...30 idle minutes end it.
    t.clock.advanceMinutes(31);
    expect(
      (await t.http.get('/auth/me').set('cookie', cookie).expect(401)).body
        .code,
    ).toBe('SESSION_EXPIRED');
  });

  it('refuses a temporary PIN after seven days', async () => {
    const created = await newOperative();
    t.clock.advanceDays(8);
    const response = await t.http
      .post('/auth/login')
      .send({
        username: created.credentials.username,
        pin: created.credentials.temporaryPin,
        client: 'mobile',
      })
      .expect(401);
    expect(response.body.code).toBe('TEMPORARY_PIN_EXPIRED');
  });

  it('stops a deactivated user signing in and ends their session (USR-007, USR-AC-04)', async () => {
    const created = await newOperative();
    const { client, pin } = await activate(t, created.credentials);
    await org.admin.post(`/users/${created.user.id}/deactivate`).expect(200);

    expect((await client.get('/auth/me').expect(401)).body.code).toBe(
      'ACCOUNT_INACTIVE',
    );
    const login = await t.http
      .post('/auth/login')
      .send({ username: created.credentials.username, pin, client: 'mobile' })
      .expect(403);
    expect(login.body.code).toBe('ACCOUNT_INACTIVE');
  });

  it('gives the same answer for an unknown username as for a wrong PIN', async () => {
    const response = await t.http
      .post('/auth/login')
      .send({ username: `nobody${uid()}`, pin: '258147', client: 'mobile' })
      .expect(401);
    expect(response.body).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Incorrect username or PIN.',
    });
    expect(response.body.details).toBeUndefined();
  });

  it('signs out and ends the session', async () => {
    const created = await newOperative();
    const { client } = await activate(t, created.credentials);
    await client.post('/auth/logout').expect(204);
    expect((await client.get('/auth/me').expect(401)).body.code).toBe(
      'SESSION_REVOKED',
    );
  });

  it('records sign-in, failure, lockout and PIN events in the audit history (SEC-004)', async () => {
    const created = await newOperative();
    await activate(t, created.credentials);
    await t.http.post('/auth/login').send({
      username: created.credentials.username,
      pin: '999000',
      client: 'mobile',
    });

    const events = (
      await org.admin
        .get('/audit-events?category=auth&pageSize=100')
        .expect(200)
    ).body as Paginated<AuditEvent>;
    const mine = events.items
      .filter((event) => event.entityId === created.user.id)
      .map((e) => e.action);
    expect(mine).toEqual(
      expect.arrayContaining([
        'auth.login.succeeded',
        'auth.pin.changed',
        'auth.login.failed',
      ]),
    );
    const failed = events.items.find(
      (e) => e.entityId === created.user.id && e.action === 'auth.login.failed',
    )!;
    expect(failed.metadata).toHaveProperty('attempt', 1);
  });

  it('validates sign-in input and never leaks internals', async () => {
    const response = await t.http
      .post('/auth/login')
      .send({ username: '', pin: '12' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(
      response.body.fieldErrors.map((e: { field: string }) => e.field),
    ).toEqual(expect.arrayContaining(['username', 'pin']));
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toMatch(
      /stack|select|corecheck\./i,
    );
  });
});
