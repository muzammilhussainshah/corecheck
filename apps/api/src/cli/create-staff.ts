import '../config/load-env-file.js';
import { parseArgs } from 'node:util';
import { DataSource } from 'typeorm';
import { createStaffSchema } from '@corecheck/shared';
import { AuditService } from '../audit/audit.service.js';
import { generateTemporaryPassword, SecretHasher } from '../common/crypto.js';
import { validateEnv } from '../config/env.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { PlatformStaffEntity } from '../database/entities.js';

/**
 * Creates a CoreCheck staff account from the command line — how the first
 * owner is set up. Later staff are added from the admin portal.
 *
 *   npm run staff:create -w @corecheck/api -- --email you@corecheck.io --name "Your Name" [--role owner]
 */
const run = async () => {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', default: 'owner' },
    },
  });
  const input = createStaffSchema.parse({
    email: values.email,
    name: values.name,
    staffRole: values.role,
  });

  const env = validateEnv(process.env);
  const dataSource = await new DataSource(
    buildDataSourceOptions(env),
  ).initialize();
  try {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await new SecretHasher(env.PIN_PEPPER).hash(
      temporaryPassword,
    );
    await dataSource.transaction(async (manager) => {
      const result = await manager.insert(PlatformStaffEntity, {
        email: input.email,
        name: input.name,
        staffRole: input.staffRole,
        passwordHash,
        mustChangePassword: true,
        status: 'active',
        failedLoginAttempts: 0,
      });
      await new AuditService().record(manager, {
        scope: 'platform',
        orgId: null,
        actor: { type: 'system', id: null, name: 'Command line' },
        action: 'staff.created',
        entityType: 'staff',
        entityId: (result.identifiers[0] as { id: string }).id,
        summary: `Created staff member ${input.name} (${input.staffRole}) from the command line`,
      });
    });

    console.log(`\nCreated ${input.staffRole} ${input.name} <${input.email}>`);
    console.log(`Temporary password: ${temporaryPassword}`);
    console.log(
      'Sign in to the admin portal: you will set up two-factor authentication',
    );
    console.log('and choose a new password.\n');
  } finally {
    await dataSource.destroy();
  }
};

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
