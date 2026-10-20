import type { EntityManager } from 'typeorm';
import { STANDARD_ROLES, type StandardRoleKey } from '@corecheck/shared';
import {
  DisciplineEntity,
  RoleEntity,
  RolePermissionEntity,
} from '../database/entities.js';

/** Disciplines every organisation starts with (ORG-004); Admins can add more. */
export const DEFAULT_DISCIPLINES = [
  'Mechanical',
  'Electrical',
  'Communications',
  'Specialist',
] as const;

/**
 * Gives a new organisation its own copy of the five standard roles and the
 * default disciplines. Returns the new role ids by standard key.
 */
export const seedOrganisationDefaults = async (
  manager: EntityManager,
  orgId: string,
): Promise<Record<StandardRoleKey, string>> => {
  const roleIds = {} as Record<StandardRoleKey, string>;

  for (const role of STANDARD_ROLES) {
    const result = await manager.insert(RoleEntity, {
      orgId,
      standardKey: role.key,
      name: role.name,
      description: role.description,
      orgWideScope: role.orgWideScope,
    });
    const roleId = (result.identifiers[0] as { id: string }).id;
    roleIds[role.key] = roleId;
    await manager.insert(
      RolePermissionEntity,
      role.permissions.map((permission) => ({ orgId, roleId, permission })),
    );
  }

  await manager.insert(
    DisciplineEntity,
    DEFAULT_DISCIPLINES.map((name) => ({ orgId, name })),
  );

  return roleIds;
};
