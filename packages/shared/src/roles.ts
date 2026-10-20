import {
  PERMISSION_CODES,
  hasPrivilegedPermission,
  type PermissionCode,
} from './permissions.js';

/**
 * The five standard roles (FRD 4.1) with their default permissions from
 * Appendix C. Every new organisation receives a copy of each; standard roles
 * cannot be edited, but an Admin can duplicate one into a custom role.
 */

export const STANDARD_ROLE_KEYS = [
  'operative',
  'technician',
  'supervisor',
  'manager',
  'admin',
] as const;

export type StandardRoleKey = (typeof STANDARD_ROLE_KEYS)[number];

export interface StandardRoleDefinition {
  key: StandardRoleKey;
  name: string;
  description: string;
  /** True when the role sees the whole organisation rather than assigned scope. */
  orgWideScope: boolean;
  permissions: readonly PermissionCode[];
}

/** Permissions every standard role holds. */
const EVERYONE: readonly PermissionCode[] = [
  'plant.view',
  'reception.complete',
  'documents.view',
  'documents.upload',
  'meters.record',
  'schedules.view',
  'checks.view',
  'checks.perform',
  'checks.export',
  'defects.view',
  'org_structure.view',
  'notifications.view_own',
];

/** Defect work open to Technicians and every reviewing role. */
const DEFECT_WORK: readonly PermissionCode[] = [
  'defects.start',
  'defects.record_work',
  'defects.verify',
  'defects.close',
];

/** What Supervisors, Managers and Admins share beyond EVERYONE. */
const REVIEWERS: readonly PermissionCode[] = [
  ...DEFECT_WORK,
  'plant.assign',
  'plant.qr',
  'plant.export',
  'reception.assign_template',
  'reception.approve',
  'plant_status.restrict',
  'plant_status.return_to_service',
  'documents.manage',
  'documents.verify',
  'meters.correct',
  'templates.view',
  'schedules.assign',
  'schedules.reschedule',
  'schedules.manage_overdue',
  'checks.review',
  'checks.reopen',
  'checks.cancel',
  'defects.assign',
  'defects.approve_verification',
  'users.view',
  'reports.view',
  'reports.export',
];

const MANAGER_EXTRA: readonly PermissionCode[] = [
  'plant.create',
  'plant.edit',
  'plant.manage_identifiers',
  'plant.archive',
  'plant.import',
  'plant_status.override',
  'checks.edit_submitted',
  'defects.reopen',
  'defects.override_restriction',
  'users.manage',
  'users.reset_pin',
  'users.assign_scope',
  'roles.view',
  'audit.view_operational',
  'cold_storage.retrieve',
];

export const STANDARD_ROLES: readonly StandardRoleDefinition[] = [
  {
    key: 'operative',
    name: 'Operative',
    description:
      'Carries out operational and reception checks and records problems.',
    orgWideScope: false,
    permissions: [...EVERYONE, 'plant.create'],
  },
  {
    key: 'technician',
    name: 'Technician',
    description:
      'Completes technical checks, maintenance and repairs within assigned disciplines.',
    orgWideScope: false,
    permissions: [...EVERYONE, ...DEFECT_WORK],
  },
  {
    key: 'supervisor',
    name: 'Supervisor',
    description:
      'Manages and reviews day-to-day work for assigned teams, disciplines and sites.',
    orgWideScope: false,
    permissions: [...EVERYONE, ...REVIEWERS],
  },
  {
    key: 'manager',
    name: 'Manager',
    description:
      'Oversees plant, performance, compliance and risk across authorised sites.',
    orgWideScope: false,
    permissions: [...EVERYONE, ...REVIEWERS, ...MANAGER_EXTRA],
  },
  {
    key: 'admin',
    name: 'Admin',
    description:
      "Configures and controls the organisation's CoreCheck workspace.",
    orgWideScope: true,
    // Admin has every customer-workspace permission (Appendix C).
    permissions: PERMISSION_CODES,
  },
];

export const getStandardRole = (
  key: StandardRoleKey,
): StandardRoleDefinition => {
  const role = STANDARD_ROLES.find((candidate) => candidate.key === key);
  if (!role) throw new Error(`Unknown standard role: ${key}`);
  return role;
};

/**
 * A role is privileged when it is Admin or Manager, or when it holds a
 * user-, role- or organisation-management permission (ROL-004).
 */
export const isPrivilegedRole = (role: {
  standardKey: StandardRoleKey | null;
  permissions: Iterable<string>;
}): boolean =>
  role.standardKey === 'admin' ||
  role.standardKey === 'manager' ||
  hasPrivilegedPermission(role.permissions);
