import { randomUUID } from 'node:crypto';
import { generate, generateSecret } from 'otplib';
import supertest from 'supertest';
import type {
  CreateOrganisationInput,
  CreateOrganisationResponse,
  CreateUserInput,
  IssuedCredentials,
  RoleSummary,
  StaffRole,
  StandardRoleKey,
  UserWithCredentials,
} from '@corecheck/shared';
import { addDays, dateInTimeZone } from '../../src/common/clock.js';
import { SecretBox, SecretHasher } from '../../src/common/crypto.js';
import { PlatformStaffEntity } from '../../src/database/entities.js';
import { TEST_SECRETS, type TestApp } from './test-app.js';

type Agent = ReturnType<typeof supertest.agent>;

/** A short random suffix so tests never collide on unique names. */
export const uid = (): string => randomUUID().slice(0, 8);

/** Strong six-digit PINs for accounts the tests activate. */
const STRONG_PINS = [
  '258147',
  '369258',
  '147369',
  '285714',
  '714285',
  '592683',
];
let pinCursor = 0;
export const strongPin = (): string =>
  STRONG_PINS[pinCursor++ % STRONG_PINS.length]!;

/** An authenticated customer API client (mobile-style bearer token). */
export class ApiClient {
  constructor(
    private readonly http: TestApp['http'],
    readonly token: string,
  ) {}

  get(url: string) {
    return this.http.get(url).set('authorization', `Bearer ${this.token}`);
  }

  post(url: string, body?: object) {
    const request = this.http
      .post(url)
      .set('authorization', `Bearer ${this.token}`);
    return body === undefined ? request : request.send(body);
  }

  patch(url: string, body: object) {
    return this.http
      .patch(url)
      .set('authorization', `Bearer ${this.token}`)
      .send(body);
  }
}

// --------------------------------------------------------------- staff

export interface StaffAccount {
  id: string;
  email: string;
  password: string;
  secret: string;
}

/** A staff account with MFA already enrolled, written straight to the database. */
export const createStaffAccount = async (
  t: TestApp,
  staffRole: StaffRole = 'owner',
): Promise<StaffAccount> => {
  const email = `staff.${uid()}@corecheck.test`;
  const password = 'Correct-Horse-Battery-Staple-1';
  const secret = generateSecret();
  const result = await t.dataSource.manager.insert(PlatformStaffEntity, {
    email,
    name: `Staff ${staffRole} ${uid()}`,
    staffRole,
    passwordHash: await new SecretHasher(TEST_SECRETS.PIN_PEPPER).hash(
      password,
    ),
    mustChangePassword: false,
    mfaSecretEncrypted: new SecretBox(TEST_SECRETS.MFA_ENCRYPTION_KEY).seal(
      secret,
    ),
    mfaEnabledAt: new Date(),
    status: 'active',
    failedLoginAttempts: 0,
  });
  return {
    id: (result.identifiers[0] as { id: string }).id,
    email,
    password,
    secret,
  };
};

export const totp = (secret: string): Promise<string> => generate({ secret });

/** A signed-in staff browser session (cookies kept by the agent). */
export const staffSession = async (
  t: TestApp,
  account: StaffAccount,
): Promise<Agent> => {
  const agent = supertest.agent(t.server);
  await agent
    .post('/platform/auth/login')
    .send({ email: account.email, password: account.password })
    .expect(200);
  await agent
    .post('/platform/auth/mfa/verify')
    .send({ code: await totp(account.secret) })
    .expect(200);
  return agent;
};

// -------------------------------------------------------- organisations

export const organisationInput = (
  overrides: Partial<CreateOrganisationInput> = {},
): CreateOrganisationInput => {
  const timeZone = overrides.timeZone ?? 'Europe/London';
  const now = new Date();
  return {
    name: `Org ${uid()}`,
    industry: 'Construction',
    contactName: 'Pat Contact',
    contactEmail: 'pat.contact@example.com',
    contactPhone: '+44 20 7946 0000',
    address: '1 Test Street, Leeds',
    country: 'United Kingdom',
    timeZone,
    seatLimit: 10,
    startsOn: dateInTimeZone(addDays(now, -1), timeZone),
    expiresOn: dateInTimeZone(addDays(now, 365), timeZone),
    firstAdmin: { firstName: 'Ada', lastName: 'Admin' },
    ...overrides,
  };
};

/** Signs in with a username and PIN as the mobile app does; returns the token. */
export const signIn = async (
  t: TestApp,
  username: string,
  pin: string,
): Promise<string> => {
  const response = await t.http
    .post('/auth/login')
    .send({ username, pin, client: 'mobile' })
    .expect(200);
  return (response.body as { token: string }).token;
};

/** First sign-in with a temporary PIN, replaced by a strong one. */
export const activate = async (
  t: TestApp,
  credentials: IssuedCredentials,
): Promise<{ client: ApiClient; pin: string }> => {
  const token = await signIn(t, credentials.username, credentials.temporaryPin);
  const client = new ApiClient(t.http, token);
  const pin = strongPin();
  await client
    .post('/auth/change-pin', {
      currentPin: credentials.temporaryPin,
      newPin: pin,
    })
    .expect(200);
  return { client, pin };
};

export interface OrganisationFixture {
  orgId: string;
  admin: ApiClient;
  adminUsername: string;
  roleIds: Record<StandardRoleKey, string>;
}

/** Provisions an organisation through the staff API and activates its first Admin. */
export const setUpOrganisation = async (
  t: TestApp,
  staff: Agent,
  overrides: Partial<CreateOrganisationInput> = {},
): Promise<OrganisationFixture> => {
  const created = (
    await staff
      .post('/platform/organisations')
      .send(organisationInput(overrides))
      .expect(201)
  ).body as CreateOrganisationResponse;
  const { client: admin } = await activate(t, created.credentials);
  const roles = (await admin.get('/roles').expect(200)).body as RoleSummary[];
  const roleIds = Object.fromEntries(
    roles
      .filter((role) => role.standardKey)
      .map((role) => [role.standardKey, role.id]),
  ) as Record<StandardRoleKey, string>;
  return {
    orgId: created.organisation.id,
    admin,
    adminUsername: created.credentials.username,
    roleIds,
  };
};

/** Creates a user through the API and signs them in with a strong PIN. */
export const createActiveUser = async (
  t: TestApp,
  creator: ApiClient,
  input: CreateUserInput,
): Promise<{
  id: string;
  username: string;
  client: ApiClient;
  pin: string;
}> => {
  const created = (await creator.post('/users', input).expect(201))
    .body as UserWithCredentials;
  const { client, pin } = await activate(t, created.credentials);
  return {
    id: created.user.id,
    username: created.credentials.username,
    client,
    pin,
  };
};

export const createSite = async (
  admin: ApiClient,
  name = `Site ${uid()}`,
): Promise<string> =>
  ((await admin.post('/sites', { name }).expect(201)).body as { id: string })
    .id;

export const createTeam = async (
  admin: ApiClient,
  name = `Team ${uid()}`,
): Promise<string> =>
  ((await admin.post('/teams', { name }).expect(201)).body as { id: string })
    .id;
