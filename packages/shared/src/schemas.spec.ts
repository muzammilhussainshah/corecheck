import { describe, expect, it } from 'vitest';
import {
  changePinSchema,
  createOrganisationSchema,
  createRoleSchema,
  createUserSchema,
  customerLoginSchema,
  listUsersQuerySchema,
} from './schemas.js';

const fieldsOf = (result: {
  success: boolean;
  error?: { issues: Array<{ path: PropertyKey[] }> };
}) => result.error?.issues.map((issue) => issue.path.join('.')) ?? [];

describe('shared request schemas', () => {
  it('normalises sign-in usernames and defaults the client to web', () => {
    expect(
      customerLoginSchema.parse({ username: '  JohnSmith42 ', pin: '258147' }),
    ).toEqual({
      username: 'johnsmith42',
      pin: '258147',
      client: 'web',
    });
  });

  it('rejects weak or unchanged new PINs', () => {
    expect(
      fieldsOf(
        changePinSchema.safeParse({ currentPin: '258147', newPin: '123456' }),
      ),
    ).toEqual(['newPin']);
    expect(
      fieldsOf(
        changePinSchema.safeParse({ currentPin: '258147', newPin: '258147' }),
      ),
    ).toEqual(['newPin']);
    expect(
      changePinSchema.safeParse({ currentPin: '258147', newPin: '369258' })
        .success,
    ).toBe(true);
  });

  it('trims names, de-duplicates scope and treats a blank email as none', () => {
    const roleId = '7d0f2c1a-3b4e-4f5a-9b6c-7d8e9f0a1b2c';
    const siteId = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
    expect(
      createUserSchema.parse({
        firstName: ' Ann ',
        lastName: 'Lee',
        email: '',
        roleId,
        siteIds: [siteId, siteId],
      }),
    ).toEqual({
      firstName: 'Ann',
      lastName: 'Lee',
      email: undefined,
      roleId,
      siteIds: [siteId],
      teamIds: [],
      disciplineIds: [],
    });
  });

  it('only accepts permissions from the catalogue', () => {
    expect(
      createRoleSchema.safeParse({ name: 'X', permissions: ['plant.view'] })
        .success,
    ).toBe(true);
    expect(
      createRoleSchema.safeParse({
        name: 'X',
        permissions: ['root.everything'],
      }).success,
    ).toBe(false);
  });

  it('checks organisation dates and time zones', () => {
    const valid = {
      name: 'Acme',
      industry: 'Construction',
      contactName: 'Pat',
      contactEmail: 'PAT@Example.com',
      contactPhone: '+44 (0)20 7946 0000',
      address: '1 Street',
      country: 'United Kingdom',
      timeZone: 'Europe/London',
      seatLimit: 10,
      startsOn: '2026-01-01',
      expiresOn: '2026-12-31',
      firstAdmin: { firstName: 'Ada', lastName: 'Admin' },
    };
    expect(createOrganisationSchema.parse(valid).contactEmail).toBe(
      'pat@example.com',
    );
    expect(
      fieldsOf(
        createOrganisationSchema.safeParse({
          ...valid,
          expiresOn: '2025-12-31',
        }),
      ),
    ).toEqual(['expiresOn']);
    expect(
      fieldsOf(
        createOrganisationSchema.safeParse({
          ...valid,
          timeZone: 'Nowhere/City',
        }),
      ),
    ).toEqual(['timeZone']);
    expect(
      fieldsOf(createOrganisationSchema.safeParse({ ...valid, seatLimit: 0 })),
    ).toEqual(['seatLimit']);
  });

  it('coerces list query strings and caps page size', () => {
    expect(
      listUsersQuerySchema.parse({ page: '2', pageSize: '50' }),
    ).toMatchObject({ page: 2, pageSize: 50, sort: 'name' });
    expect(listUsersQuerySchema.safeParse({ pageSize: '1000' }).success).toBe(
      false,
    );
  });
});
