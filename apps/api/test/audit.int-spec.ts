import type supertest from 'supertest';
import { QueryFailedError } from 'typeorm';
import type { AuditEvent, Paginated } from '@corecheck/shared';
import { enterTenantRole } from '../src/database/db-context.js';
import {
  createSite,
  createStaffAccount,
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

describe('Audit history (FRD 20)', () => {
  let t: TestApp;
  let staff: Agent;
  let org: OrganisationFixture;
  let other: OrganisationFixture;

  beforeAll(async () => {
    t = await createTestApp();
    staff = await staffSession(t, await createStaffAccount(t));
    org = await setUpOrganisation(t, staff);
    other = await setUpOrganisation(t, staff);
    await createSite(org.admin, 'Audited site');
    await createSite(other.admin, 'Other site');
  });
  afterAll(() => t.close());

  it('cannot be changed or deleted by anyone, the table owner included (AUD-004, AUD-AC-03)', async () => {
    const manager = t.dataSource.manager;
    for (const statement of [
      `update corecheck.audit_events set summary = 'rewritten'`,
      'delete from corecheck.audit_events',
      'truncate corecheck.audit_events',
    ]) {
      await expect(manager.query(statement)).rejects.toSatisfy(
        (error) => pgCode(error) === 'CC002',
      );
    }

    await t.dataSource.transaction(async (tenant) => {
      await enterTenantRole(
        tenant,
        org.orgId,
        '00000000-0000-0000-0000-000000000000',
      );
      await expect(
        tenant.query(`delete from corecheck.audit_events`),
      ).rejects.toSatisfy((error) => pgCode(error) === '42501');
    });
  });

  it('shows an organisation only its own tenant events', async () => {
    const events = (
      await org.admin.get('/audit-events?pageSize=100').expect(200)
    ).body as Paginated<AuditEvent>;
    expect(events.items.some((e) => e.summary.includes('Audited site'))).toBe(
      true,
    );
    expect(events.items.some((e) => e.summary.includes('Other site'))).toBe(
      false,
    );
    // Internal provisioning records stay internal.
    expect(events.items.some((e) => e.action === 'organisation.created')).toBe(
      false,
    );
  });

  it('records who did what with before and after values (AUD-002)', async () => {
    const site = (
      await org.admin.post('/sites', { name: 'Before name' }).expect(201)
    ).body as { id: string };
    await org.admin
      .patch(`/sites/${site.id}`, { name: 'After name' })
      .expect(200);
    const events = (
      await org.admin
        .get('/audit-events?category=site&search=After')
        .expect(200)
    ).body as Paginated<AuditEvent>;
    const update = events.items.find(
      (e) => e.action === 'site.updated' && e.entityId === site.id,
    )!;
    expect(update).toMatchObject({
      actorType: 'user',
      before: { name: 'Before name' },
      after: { name: 'After name' },
    });
    expect(update.actorName).toContain('Ada Admin');
  });

  it('filters by date in the organisation’s time zone', async () => {
    const future = (
      await org.admin.get('/audit-events?from=2999-01-01').expect(200)
    ).body as Paginated<AuditEvent>;
    expect(future.total).toBe(0);
    const all = (
      await org.admin
        .get('/audit-events?from=2020-01-01&to=2999-12-31')
        .expect(200)
    ).body as Paginated<AuditEvent>;
    expect(all.total).toBeGreaterThan(0);
  });
});
