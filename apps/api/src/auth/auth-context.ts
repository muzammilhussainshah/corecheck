import type {
  ClientType,
  OrganisationStatus,
  PermissionCode,
  StaffRole,
  StandardRoleKey,
} from '@corecheck/shared';

/** The signed-in customer user, resolved from the session on every request. */
export interface CustomerAuth {
  sessionId: string;
  client: ClientType;
  sessionExpiresAt: Date;
  idleTimeoutSeconds: number;

  userId: string;
  orgId: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string | null;
  mustChangePin: boolean;

  roleId: string;
  roleName: string;
  standardKey: StandardRoleKey | null;
  orgWideScope: boolean;
  permissions: ReadonlySet<PermissionCode>;

  siteIds: readonly string[];
  teamIds: readonly string[];
  disciplineIds: readonly string[];

  org: {
    name: string;
    timeZone: string;
    status: OrganisationStatus;
    expiresOn: string;
    /** Past the expiry date: reads are allowed, changes are not (IAD-007). */
    readOnly: boolean;
  };
}

/** The signed-in CoreCheck staff member on internal portal routes. */
export interface StaffAuth {
  sessionId: string;
  staffId: string;
  name: string;
  email: string;
  staffRole: StaffRole;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  mustChangePassword: boolean;
}

export const fullName = (person: {
  firstName: string;
  lastName: string;
}): string => `${person.firstName} ${person.lastName}`;
