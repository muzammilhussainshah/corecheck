/**
 * The customer permission catalogue: one entry per row of FRD Appendix C
 * ("Role permission matrix"), plus organisation settings (ROL-004).
 *
 * Standard and custom roles are both built from this list (ROL-001). Internal
 * CoreCheck administration permissions are deliberately absent, so no customer
 * role can ever hold them (ROL-003).
 */

export const PERMISSION_AREAS = [
  { key: 'plant', label: 'Plant' },
  { key: 'reception', label: 'Reception' },
  { key: 'plant_status', label: 'Plant status' },
  { key: 'documents', label: 'Documents' },
  { key: 'meters', label: 'Meters' },
  { key: 'templates', label: 'Templates' },
  { key: 'schedules', label: 'Schedules' },
  { key: 'checks', label: 'Checks' },
  { key: 'defects', label: 'Defects' },
  { key: 'users', label: 'Users' },
  { key: 'roles', label: 'Roles' },
  { key: 'organisation', label: 'Organisation' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'reports', label: 'Reports' },
  { key: 'audit', label: 'Audit' },
  { key: 'cold_storage', label: 'Cold storage' },
] as const;

export type PermissionArea = (typeof PERMISSION_AREAS)[number]['key'];

export interface PermissionDefinition {
  code: string;
  area: PermissionArea;
  label: string;
}

export const PERMISSIONS = [
  // Plant
  {
    code: 'plant.view',
    area: 'plant',
    label: 'View authorised plant and history',
  },
  {
    code: 'plant.create',
    area: 'plant',
    label: 'Create Pending Reception plant',
  },
  {
    code: 'plant.edit',
    area: 'plant',
    label: 'Edit submitted/master plant data',
  },
  {
    code: 'plant.manage_identifiers',
    area: 'plant',
    label: 'Manage identifiers and move site',
  },
  {
    code: 'plant.assign',
    area: 'plant',
    label: 'Assign plant to user/team/discipline',
  },
  { code: 'plant.archive', area: 'plant', label: 'Archive or restore plant' },
  { code: 'plant.qr', area: 'plant', label: 'Generate and print QR codes' },
  { code: 'plant.import', area: 'plant', label: 'Import plant' },
  { code: 'plant.export', area: 'plant', label: 'Export plant register' },
  // Reception
  {
    code: 'reception.complete',
    area: 'reception',
    label: 'Complete assigned reception',
  },
  {
    code: 'reception.assign_template',
    area: 'reception',
    label: 'Assign published reception template',
  },
  {
    code: 'reception.approve',
    area: 'reception',
    label: 'Approve or reject reception',
  },
  // Plant status
  {
    code: 'plant_status.restrict',
    area: 'plant_status',
    label: 'Restrict plant',
  },
  {
    code: 'plant_status.return_to_service',
    area: 'plant_status',
    label: 'Return plant to service',
  },
  {
    code: 'plant_status.override',
    area: 'plant_status',
    label: 'Override restriction or failure',
  },
  // Documents
  {
    code: 'documents.view',
    area: 'documents',
    label: 'View and download documents',
  },
  { code: 'documents.upload', area: 'documents', label: 'Upload documents' },
  {
    code: 'documents.manage',
    area: 'documents',
    label: 'Edit, replace and archive documents',
  },
  {
    code: 'documents.verify',
    area: 'documents',
    label: 'Verify or reject documents',
  },
  {
    code: 'documents.configure',
    area: 'documents',
    label: 'Configure document types, requirements and expiry',
  },
  // Meters
  {
    code: 'meters.record',
    area: 'meters',
    label: 'View and record meter readings',
  },
  {
    code: 'meters.correct',
    area: 'meters',
    label: 'Correct submitted meter readings',
  },
  { code: 'meters.configure', area: 'meters', label: 'Configure meter types' },
  // Templates
  {
    code: 'templates.view',
    area: 'templates',
    label: 'View published templates',
  },
  {
    code: 'templates.manage',
    area: 'templates',
    label: 'Create, edit, publish, version and archive templates',
  },
  {
    code: 'templates.configure_questions',
    area: 'templates',
    label: 'Configure questions, triggers and evidence',
  },
  // Schedules
  {
    code: 'schedules.view',
    area: 'schedules',
    label: 'View generated checks and schedules',
  },
  {
    code: 'schedules.manage_rules',
    area: 'schedules',
    label: 'Create, edit and pause recurring rules',
  },
  {
    code: 'schedules.assign',
    area: 'schedules',
    label: 'Assign and reassign generated checks',
  },
  {
    code: 'schedules.reschedule',
    area: 'schedules',
    label: 'Reschedule individual checks',
  },
  {
    code: 'schedules.manage_overdue',
    area: 'schedules',
    label: 'Manage overdue work',
  },
  // Checks
  { code: 'checks.view', area: 'checks', label: 'View authorised checks' },
  {
    code: 'checks.perform',
    area: 'checks',
    label: 'Start, contribute evidence and submit checks',
  },
  {
    code: 'checks.review',
    area: 'checks',
    label: 'Review, approve, reject and return checks',
  },
  { code: 'checks.reopen', area: 'checks', label: 'Reopen submitted checks' },
  {
    code: 'checks.edit_submitted',
    area: 'checks',
    label: 'Edit submitted answers directly',
  },
  { code: 'checks.cancel', area: 'checks', label: 'Cancel or void checks' },
  { code: 'checks.export', area: 'checks', label: 'Export individual checks' },
  // Defects
  { code: 'defects.view', area: 'defects', label: 'View authorised Defects' },
  {
    code: 'defects.assign',
    area: 'defects',
    label: 'Classify and assign Defects',
  },
  {
    code: 'defects.start',
    area: 'defects',
    label: 'Move Defects to In Progress',
  },
  {
    code: 'defects.record_work',
    area: 'defects',
    label: 'Record corrective action and evidence',
  },
  {
    code: 'defects.verify',
    area: 'defects',
    label: 'Complete verification checks',
  },
  {
    code: 'defects.approve_verification',
    area: 'defects',
    label: 'Approve verification',
  },
  {
    code: 'defects.close',
    area: 'defects',
    label: 'Close Defects after prerequisites',
  },
  { code: 'defects.reopen', area: 'defects', label: 'Reopen closed Defects' },
  {
    code: 'defects.override_restriction',
    area: 'defects',
    label: 'Override Defect restrictions',
  },
  // Users
  { code: 'users.view', area: 'users', label: 'View users' },
  {
    code: 'users.manage',
    area: 'users',
    label: 'Create, edit, activate and deactivate users',
  },
  {
    code: 'users.reset_pin',
    area: 'users',
    label: 'Reset PINs and unlock accounts',
  },
  {
    code: 'users.assign_scope',
    area: 'users',
    label: 'Assign sites, teams and disciplines',
  },
  // Roles
  { code: 'roles.view', area: 'roles', label: 'View role definitions' },
  {
    code: 'roles.manage',
    area: 'roles',
    label: 'Create, edit and assign role permissions',
  },
  // Organisation
  {
    code: 'org_structure.view',
    area: 'organisation',
    label: 'View sites, teams and disciplines',
  },
  {
    code: 'org_structure.manage',
    area: 'organisation',
    label: 'Manage sites, teams and disciplines',
  },
  {
    code: 'plant_config.manage',
    area: 'organisation',
    label: 'Manage plant types, categories and custom fields',
  },
  {
    code: 'org_settings.manage',
    area: 'organisation',
    label: 'Manage organisation settings',
  },
  // Notifications
  {
    code: 'notifications.view_own',
    area: 'notifications',
    label: 'View own notifications and manage optional preferences',
  },
  {
    code: 'notifications.configure',
    area: 'notifications',
    label: 'Configure triggers, recipients and escalation',
  },
  // Reports
  {
    code: 'reports.view',
    area: 'reports',
    label: 'View operational, compliance and Defect reports',
  },
  { code: 'reports.export', area: 'reports', label: 'Export reports' },
  // Audit
  {
    code: 'audit.view_operational',
    area: 'audit',
    label: 'View operational audit',
  },
  {
    code: 'audit.view_security',
    area: 'audit',
    label: 'View security audit and organisation settings',
  },
  // Cold storage
  {
    code: 'cold_storage.retrieve',
    area: 'cold_storage',
    label: 'Retrieve and export cold-stored records',
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSIONS.map(
  (permission) => permission.code,
);

const permissionCodeSet: ReadonlySet<string> = new Set(PERMISSION_CODES);

export const isPermissionCode = (value: string): value is PermissionCode =>
  permissionCodeSet.has(value);

/**
 * Holding any of these makes a role privileged (ROL-004): it can change who
 * may do what. Managers may not create, modify, assign or deactivate holders
 * of privileged roles (ROL-005).
 */
export const PRIVILEGED_PERMISSIONS: readonly PermissionCode[] = [
  'users.manage',
  'users.reset_pin',
  'users.assign_scope',
  'roles.manage',
  'org_settings.manage',
];

export const hasPrivilegedPermission = (
  permissions: Iterable<string>,
): boolean => {
  for (const permission of permissions) {
    if ((PRIVILEGED_PERMISSIONS as readonly string[]).includes(permission)) {
      return true;
    }
  }
  return false;
};
