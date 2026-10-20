import type {
  PermissionCode,
  StandardRoleKey,
  UserCapabilities,
  UserStatus,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';

/**
 * Who may see and administer which users (FRD 3.2, 4.2, Appendix C).
 *
 * A user's effective access needs both the action permission and the record
 * in scope (SCP-007). These rules are pure functions so they can be tested
 * exhaustively; the services call them before touching the database.
 */

export interface Actor {
  userId: string;
  standardKey: StandardRoleKey | null;
  orgWide: boolean;
  permissions: ReadonlySet<PermissionCode>;
  siteIds: readonly string[];
  teamIds: readonly string[];
}

export interface TargetUser {
  id: string;
  status: UserStatus;
  /** The user's role is privileged (ROL-004). */
  privileged: boolean;
  siteIds: readonly string[];
  teamIds: readonly string[];
}

export const actorFrom = (auth: CustomerAuth): Actor => ({
  userId: auth.userId,
  standardKey: auth.standardKey,
  orgWide: auth.orgWideScope,
  permissions: auth.permissions,
  siteIds: auth.siteIds,
  teamIds: auth.teamIds,
});

const sharesAny = (a: readonly string[], b: readonly string[]) =>
  a.some((value) => b.includes(value));

const isSubset = (inner: readonly string[], outer: readonly string[]) =>
  inner.every((value) => outer.includes(value));

/** Only the Admin role may manage privileged users and roles (ROL-005). */
export const isOrganisationAdmin = (actor: Actor): boolean =>
  actor.standardKey === 'admin';

/**
 * Admins see everyone. Supervisors see users who share one of their teams;
 * everyone else with the permission sees users who share one of their sites
 * (Appendix C: "Supervisor own team; Manager sites"). Users always see
 * themselves.
 */
export const canViewUser = (actor: Actor, target: TargetUser): boolean => {
  if (target.id === actor.userId) return true;
  if (!actor.permissions.has('users.view')) return false;
  if (actor.orgWide) return true;
  if (actor.standardKey === 'supervisor')
    return sharesAny(actor.teamIds, target.teamIds);
  return sharesAny(actor.siteIds, target.siteIds);
};

/**
 * Whether the actor may use `permission` on this user. Admins may act on
 * anyone else. Other roles may act only on non-privileged users, and unless
 * their role is organisation-wide only on users whose sites all fall within
 * their own (SCP-004, ROL-005). Nobody administers their own account here.
 */
export const canAdminister = (
  actor: Actor,
  target: TargetUser,
  permission: PermissionCode,
): boolean => {
  if (!actor.permissions.has(permission)) return false;
  if (target.id === actor.userId) return false;
  if (isOrganisationAdmin(actor)) return true;
  if (target.privileged) return false;
  if (actor.orgWide) return true;
  return target.siteIds.length > 0 && isSubset(target.siteIds, actor.siteIds);
};

/** A role the actor may give to a user: active, and non-privileged unless Admin. */
export const canAssignRole = (
  actor: Actor,
  role: { privileged: boolean; archived: boolean },
): boolean =>
  !role.archived && (isOrganisationAdmin(actor) || !role.privileged);

/** Sites the actor may assign: any for organisation-wide roles, else their own. */
export const canAssignSites = (
  actor: Actor,
  siteIds: readonly string[],
): boolean =>
  isOrganisationAdmin(actor) ||
  actor.orgWide ||
  isSubset(siteIds, actor.siteIds);

export const capabilitiesFor = (
  actor: Actor,
  target: TargetUser,
): UserCapabilities => {
  const manage = canAdminister(actor, target, 'users.manage');
  const resetPin = canAdminister(actor, target, 'users.reset_pin');
  return {
    canEdit: manage,
    canChangeRole: manage,
    canAssignScope: canAdminister(actor, target, 'users.assign_scope'),
    canResetPin: resetPin,
    canUnlock: resetPin && target.status === 'locked',
    canDeactivate: manage && target.status !== 'inactive',
    canReactivate: manage && target.status === 'inactive',
  };
};
