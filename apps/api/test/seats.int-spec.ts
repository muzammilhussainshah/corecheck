import type supertest from 'supertest';
import type {
  AuditEvent,
  Paginated,
  SeatUsage,
  UserWithCredentials,
} from '@corecheck/shared';
import {
  createStaffAccount,
  type OrganisationFixture,
  setUpOrganisation,
  staffSession,
} from './support/fixtures.js';
import { createTestApp, type TestApp } from './support/test-app.js';

type Agent = ReturnType<typeof supertest.agent>;

describe('Seat limits (IAD-005, IAD-AC-02)', () => {
  let t: TestApp;
  let staff: Agent;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
  });
  afterAll(() => t.close());

  const addOperative = (org: OrganisationFixture, lastName: string) =>
    org.admin.post('/users', {
      firstName: 'Seat',
      lastName,
      roleId: org.roleIds.operative,
    });

  it('blocks activation beyond the contracted seats and frees a seat on deactivation', async () => {
    const org = await setUpOrganisation(t, staff, { seatLimit: 3 });
    const first = (await addOperative(org, 'One').expect(201))
      .body as UserWithCredentials;
    await addOperative(org, 'Two').expect(201);

    const refused = await addOperative(org, 'Three').expect(409);
    expect(refused.body.code).toBe('SEAT_LIMIT_REACHED');
    expect(refused.body.message).toMatch(/Contact CoreCheck/);
    expect(
      (await org.admin.get('/users/seat-usage').expect(200)).body,
    ).toEqual<SeatUsage>({
      limit: 3,
      used: 3,
      available: 0,
    });

    await org.admin.post(`/users/${first.user.id}/deactivate`).expect(200);
    const third = (await addOperative(org, 'Three').expect(201))
      .body as UserWithCredentials;

    // Reactivating someone while full is refused too.
    expect(
      (await org.admin.post(`/users/${first.user.id}/reactivate`).expect(409))
        .body.code,
    ).toBe('SEAT_LIMIT_REACHED');

    // The refusal is on record for the organisation.
    const events = (
      await org.admin.get('/audit-events?category=seat_limit').expect(200)
    ).body as Paginated<AuditEvent>;
    expect(events.total).toBeGreaterThanOrEqual(2);

    // A locked user still holds a seat; deactivating them releases it.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await t.http.post('/auth/login').send({
        username: third.credentials.username,
        pin: '999000',
        client: 'mobile',
      });
    }
    await addOperative(org, 'Four').expect(409);
    await org.admin.post(`/users/${third.user.id}/deactivate`).expect(200);
    await addOperative(org, 'Four').expect(201);
  });

  it('holds under concurrent requests: only the free seat is taken', async () => {
    const org = await setUpOrganisation(t, staff, { seatLimit: 2 });
    const attempts = await Promise.all(
      ['A', 'B', 'C', 'D', 'E'].map((name) =>
        addOperative(org, `Racer${name}`),
      ),
    );
    const statuses = attempts.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(
      ((await org.admin.get('/users/seat-usage').expect(200)).body as SeatUsage)
        .used,
    ).toBe(2);
  });

  it('refuses to lower the limit below the seats in use', async () => {
    const org = await setUpOrganisation(t, staff, { seatLimit: 5 });
    await addOperative(org, 'One').expect(201);
    await addOperative(org, 'Two').expect(201);

    const tooLow = await staff
      .patch(`/platform/organisations/${org.orgId}`)
      .send({ seatLimit: 2 })
      .expect(400);
    expect(tooLow.body.fieldErrors[0].field).toBe('seatLimit');
    const ok = await staff
      .patch(`/platform/organisations/${org.orgId}`)
      .send({ seatLimit: 3 })
      .expect(200);
    expect(ok.body.seatLimit).toBe(3);
  });
});
