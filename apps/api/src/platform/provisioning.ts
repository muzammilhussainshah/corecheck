import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import type {
  createOrganisationSchema,
  IssuedCredentials,
  OrganisationAdmin,
} from '@corecheck/shared';
import type { AuditActor, AuditService } from '../audit/audit.service.js';
import type { SecretHasher } from '../common/crypto.js';
import { OrganisationEntity, UserEntity } from '../database/entities.js';
import { seedOrganisationDefaults } from '../organisation/defaults.js';
import {
  issueTemporaryPin,
  temporaryPinColumns,
} from '../users/credentials.js';
import { generateUsername } from '../users/username.js';

type ProvisionInput = z.output<typeof createOrganisationSchema>;

export interface ProvisionedOrganisation {
  orgId: string;
  admin: OrganisationAdmin;
  credentials: IssuedCredentials;
}

/**
 * Creates an isolated organisation with its standard roles, default
 * disciplines and first Organisation Admin (IAD-002, IAD-010, IAD-AC-01).
 * Run inside one SystemDb transaction so it happens completely or not at all.
 */
export const provisionOrganisation = async (
  manager: EntityManager,
  deps: { hasher: SecretHasher; audit: AuditService; now: Date },
  input: ProvisionInput,
  actor: AuditActor,
  metadata: Record<string, unknown> = {},
): Promise<ProvisionedOrganisation> => {
  const { firstAdmin, ...fields } = input;
  const inserted = await manager.insert(OrganisationEntity, {
    ...fields,
    status: 'active',
  });
  const orgId = (inserted.identifiers[0] as { id: string }).id;
  const roleIds = await seedOrganisationDefaults(manager, orgId);

  const username = await generateUsername(
    manager,
    firstAdmin.firstName,
    firstAdmin.lastName,
  );
  const temporary = await issueTemporaryPin(deps.hasher, deps.now);
  const userInsert = await manager.insert(UserEntity, {
    orgId,
    firstName: firstAdmin.firstName,
    lastName: firstAdmin.lastName,
    username,
    email: firstAdmin.email ?? null,
    roleId: roleIds.admin,
    status: 'active',
    ...temporaryPinColumns(temporary),
  });
  const adminId = (userInsert.identifiers[0] as { id: string }).id;

  await deps.audit.record(manager, {
    scope: 'platform',
    orgId,
    actor,
    action: 'organisation.created',
    entityType: 'organisation',
    entityId: orgId,
    summary: `Created organisation ${fields.name} with ${fields.seatLimit} seats and first Organisation Admin ${username}`,
    after: { ...fields },
    metadata,
  });
  await deps.audit.record(manager, {
    scope: 'tenant',
    orgId,
    actor,
    action: 'user.created',
    entityType: 'user',
    entityId: adminId,
    summary: `First Organisation Admin ${firstAdmin.firstName} ${firstAdmin.lastName} (${username}) created by CoreCheck`,
  });

  return {
    orgId,
    admin: {
      id: adminId,
      firstName: firstAdmin.firstName,
      lastName: firstAdmin.lastName,
      username,
      status: 'active',
      lastLoginAt: null,
    },
    credentials: {
      username,
      temporaryPin: temporary.pin,
      expiresAt: temporary.expiresAt.toISOString(),
    },
  };
};
