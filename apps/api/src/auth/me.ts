import { isPrivilegedRole, type MeResponse } from '@corecheck/shared';
import type { CustomerAuth } from './auth-context.js';

export const toMeResponse = (auth: CustomerAuth): MeResponse => ({
  user: {
    id: auth.userId,
    firstName: auth.firstName,
    lastName: auth.lastName,
    username: auth.username,
    email: auth.email,
  },
  organisation: {
    id: auth.orgId,
    name: auth.org.name,
    timeZone: auth.org.timeZone,
    status: auth.org.status,
    expiresOn: auth.org.expiresOn,
    readOnly: auth.org.readOnly,
  },
  role: {
    id: auth.roleId,
    name: auth.roleName,
    standardKey: auth.standardKey,
    orgWideScope: auth.orgWideScope,
    privileged: isPrivilegedRole({
      standardKey: auth.standardKey,
      permissions: auth.permissions,
    }),
  },
  permissions: [...auth.permissions].sort(),
  scope: {
    orgWide: auth.orgWideScope,
    siteIds: [...auth.siteIds],
    teamIds: [...auth.teamIds],
    disciplineIds: [...auth.disciplineIds],
  },
  mustChangePin: auth.mustChangePin,
  session: {
    client: auth.client,
    expiresAt: auth.sessionExpiresAt.toISOString(),
    idleTimeoutSeconds: auth.idleTimeoutSeconds,
  },
});
