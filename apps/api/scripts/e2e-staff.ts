/**
 * Creates a throwaway CoreCheck owner with MFA already enrolled and prints its
 * credentials as JSON, for the browser end-to-end tests. Refuses to run in
 * production.
 *
 *   tsx scripts/e2e-staff.ts
 */
import '../src/config/load-env-file.js';
import { randomUUID } from 'node:crypto';
import { generateSecret } from 'otplib';
import { DataSource } from 'typeorm';
import { SecretBox, SecretHasher } from '../src/common/crypto.js';
import { validateEnv } from '../src/config/env.js';
import { buildDataSourceOptions } from '../src/database/data-source-options.js';
import { PlatformStaffEntity } from '../src/database/entities.js';

const env = validateEnv(process.env);
if (env.NODE_ENV === 'production')
  throw new Error('e2e-staff must not run in production.');

const dataSource = await new DataSource(
  buildDataSourceOptions(env),
).initialize();
const email = `e2e.${randomUUID().slice(0, 8)}@corecheck.test`;
const password = 'E2E-Owner-Passphrase-2026';
const secret = generateSecret();
await dataSource.manager.insert(PlatformStaffEntity, {
  email,
  name: 'E2E Owner',
  staffRole: 'owner',
  passwordHash: await new SecretHasher(env.PIN_PEPPER).hash(password),
  mustChangePassword: false,
  mfaSecretEncrypted: new SecretBox(env.MFA_ENCRYPTION_KEY).seal(secret),
  mfaEnabledAt: new Date(),
  status: 'active',
  failedLoginAttempts: 0,
});
await dataSource.destroy();
console.log(JSON.stringify({ email, password, secret }));
