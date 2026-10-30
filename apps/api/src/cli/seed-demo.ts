import '../config/load-env-file.js';
import { DataSource, type EntityManager } from 'typeorm';
import type { StandardRoleKey } from '@corecheck/shared';
import { AuditService } from '../audit/audit.service.js';
import { addDays, dateInTimeZone } from '../common/clock.js';
import { SecretBox, SecretHasher } from '../common/crypto.js';
import { validateEnv } from '../config/env.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import {
  AreaEntity,
  OrganisationEntity,
  PlatformStaffEntity,
  PocCheckEntity,
  RoleEntity,
  SiteEntity,
  TeamEntity,
  UserEntity,
  UserSiteEntity,
  UserTeamEntity,
} from '../database/entities.js';
import { newTotpSecret, totpUri } from '../platform/totp.js';
import { provisionOrganisation } from '../platform/provisioning.js';
import { generateUsername } from '../users/username.js';
import { seedPlant } from './seed-plant.js';

/**
 * Local demo data: a staff owner, one organisation with sites, teams, a user
 * for every standard role, offline-sync checks and plant at each stage. Development only —
 * the credentials it prints are deliberately simple.
 *
 *   npm run seed:demo -w @corecheck/api
 */

const ORG_NAME = 'Northwind Construction (Demo)';
const STAFF_EMAIL = 'owner@corecheck.local';
const STAFF_PASSWORD = 'CoreCheck-Demo-2026';

const DEMO_USERS: Array<{
  firstName: string;
  lastName: string;
  role: StandardRoleKey;
  pin: string;
  sites: string[];
  teams: string[];
}> = [
  {
    firstName: 'Maya',
    lastName: 'Manager',
    role: 'manager',
    pin: '246813',
    sites: ['Leeds Depot'],
    teams: [],
  },
  {
    firstName: 'Sam',
    lastName: 'Supervisor',
    role: 'supervisor',
    pin: '357913',
    sites: ['Leeds Depot'],
    teams: ['Lifting'],
  },
  {
    firstName: 'Omar',
    lastName: 'Operative',
    role: 'operative',
    pin: '468024',
    sites: ['Leeds Depot'],
    teams: ['Lifting'],
  },
  {
    firstName: 'Tara',
    lastName: 'Technician',
    role: 'technician',
    pin: '579135',
    sites: ['Manchester Yard'],
    teams: ['Groundworks'],
  },
];

const insertId = (result: { identifiers: unknown[] }) =>
  (result.identifiers[0] as { id: string }).id;

const seedStaff = async (
  manager: EntityManager,
  hasher: SecretHasher,
  secretBox: SecretBox,
) => {
  if (await manager.findOneBy(PlatformStaffEntity, { email: STAFF_EMAIL }))
    return null;
  const secret = newTotpSecret();
  await manager.insert(PlatformStaffEntity, {
    email: STAFF_EMAIL,
    name: 'Demo Owner',
    staffRole: 'owner',
    passwordHash: await hasher.hash(STAFF_PASSWORD),
    mustChangePassword: false,
    mfaSecretEncrypted: secretBox.seal(secret),
    mfaEnabledAt: new Date(),
    status: 'active',
    failedLoginAttempts: 0,
  });
  return secret;
};

const run = async () => {
  const env = validateEnv(process.env);
  if (env.NODE_ENV === 'production')
    throw new Error('seed:demo must not run in production.');
  // A remote database (staging) must be named explicitly, so a .env that
  // points at production can never be seeded by accident. Supabase projects
  // share pooler hosts, so the target includes the user (postgres.<ref>).
  const url = new URL(env.DATABASE_URL);
  const target = `${decodeURIComponent(url.username)}@${url.hostname}`;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && process.env.DEMO_SEED_TARGET !== target)
    throw new Error(
      `seed:demo refuses the remote database ${target}. If this is staging, ` +
        `run it again with DEMO_SEED_TARGET=${target}.`,
    );

  const dataSource = await new DataSource(
    buildDataSourceOptions(env),
  ).initialize();
  const hasher = new SecretHasher(env.PIN_PEPPER);
  const secretBox = new SecretBox(env.MFA_ENCRYPTION_KEY);
  const audit = new AuditService();

  try {
    await dataSource.transaction(async (manager) => {
      const staffSecret = await seedStaff(manager, hasher, secretBox);
      const existing = await manager.findOneBy(OrganisationEntity, {
        name: ORG_NAME,
      });
      if (existing) {
        await seedPlant(manager, env, existing.id);
        console.log(`"${ORG_NAME}" already exists; nothing else to do.`);
        return;
      }

      const now = new Date();
      const timeZone = 'Europe/London';
      const { orgId, credentials } = await provisionOrganisation(
        manager,
        { hasher, audit, now },
        {
          name: ORG_NAME,
          industry: 'Construction',
          contactName: 'Alex Admin',
          contactEmail: 'alex.admin@northwind.example',
          contactPhone: '+44 20 7946 0000',
          address: '1 Demo Street, Leeds LS1 1AA',
          country: 'United Kingdom',
          timeZone,
          seatLimit: 25,
          startsOn: dateInTimeZone(addDays(now, -30), timeZone),
          expiresOn: dateInTimeZone(addDays(now, 365), timeZone),
          firstAdmin: {
            firstName: 'Alex',
            lastName: 'Admin',
            email: 'alex.admin@northwind.example',
          },
        },
        { type: 'system', id: null, name: 'Demo seed' },
      );

      // Demo convenience: known PINs that need no change at first sign-in.
      const ADMIN_PIN = '135792';
      await manager.update(
        UserEntity,
        { username: credentials.username },
        {
          pinHash: await hasher.hash(ADMIN_PIN),
          mustChangePin: false,
          tempPinExpiresAt: null,
        },
      );

      const siteIds: Record<string, string> = {};
      for (const [name, areas] of [
        ['Leeds Depot', ['Yard A', 'Workshop']],
        ['Manchester Yard', ['North Bay']],
      ] as const) {
        siteIds[name] = insertId(
          await manager.insert(SiteEntity, {
            orgId,
            name,
            code: null,
            address: null,
          }),
        );
        for (const area of areas) {
          await manager.insert(AreaEntity, {
            orgId,
            siteId: siteIds[name],
            name: area,
          });
        }
      }
      const teamIds: Record<string, string> = {};
      for (const name of ['Lifting', 'Groundworks']) {
        teamIds[name] = insertId(
          await manager.insert(TeamEntity, { orgId, name, description: null }),
        );
      }

      const roles = await manager.findBy(RoleEntity, { orgId });
      const roleId = (key: StandardRoleKey) =>
        roles.find((role) => role.standardKey === key)!.id;

      const printed = [
        { role: 'admin', username: credentials.username, pin: ADMIN_PIN },
      ];
      for (const person of DEMO_USERS) {
        const username = await generateUsername(
          manager,
          person.firstName,
          person.lastName,
        );
        const userId = insertId(
          await manager.insert(UserEntity, {
            orgId,
            firstName: person.firstName,
            lastName: person.lastName,
            username,
            email: null,
            roleId: roleId(person.role),
            status: 'active',
            pinHash: await hasher.hash(person.pin),
            mustChangePin: false,
            tempPinExpiresAt: null,
            failedPinAttempts: 0,
          }),
        );
        for (const site of person.sites) {
          await manager.insert(UserSiteEntity, {
            orgId,
            userId,
            siteId: siteIds[site],
          });
        }
        for (const team of person.teams) {
          await manager.insert(UserTeamEntity, {
            orgId,
            userId,
            teamId: teamIds[team],
          });
        }
        printed.push({ role: person.role, username, pin: person.pin });
      }

      for (const [site, title, plant] of [
        ['Leeds Depot', 'Daily pre-use check', 'Excavator EX-101'],
        ['Leeds Depot', 'Daily pre-use check', 'Telehandler TH-07'],
        ['Leeds Depot', 'Weekly lifting check', 'Mobile crane MC-2'],
        ['Manchester Yard', 'Daily pre-use check', 'Generator GN-14'],
      ] as const) {
        await manager.insert(PocCheckEntity, {
          orgId,
          siteId: siteIds[site],
          title,
          plantLabel: plant,
          status: 'open',
        });
      }

      await seedPlant(manager, env, orgId);

      console.log(
        `\nSeeded "${ORG_NAME}". Customer sign-ins (web :3100, mobile):`,
      );
      console.table(printed);
      if (staffSecret) {
        console.log(`Admin portal (:3200): ${STAFF_EMAIL} / ${STAFF_PASSWORD}`);
        console.log(`Authenticator secret: ${staffSecret}`);
        console.log(
          `(or add this URL to an authenticator app: ${totpUri(STAFF_EMAIL, staffSecret)})\n`,
        );
      }
    });
  } finally {
    await dataSource.destroy();
  }
};

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
