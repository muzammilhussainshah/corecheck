/**
 * Audit action names and how they read in the audit history views. Actions
 * are dotted: the first segment is the category the views filter on.
 */
export const AUDIT_ACTIONS = {
  // Authentication and sessions (SEC-004)
  'auth.login.succeeded': 'Signed in',
  'auth.login.failed': 'Failed sign-in attempt',
  'auth.login.blocked': 'Sign-in blocked',
  'auth.account.locked': 'Account locked after failed attempts',
  'auth.logout': 'Signed out',
  'auth.session.replaced': 'Session ended by a sign-in on another device',
  'auth.pin.changed': 'PIN changed',

  // User administration (ROL-006, SEC-004)
  'user.created': 'User created',
  'user.updated': 'User details updated',
  'user.role.changed': 'Role changed',
  'user.scope.changed': 'Access scope changed',
  'user.deactivated': 'User deactivated',
  'user.reactivated': 'User reactivated',
  'user.pin.reset': 'PIN reset',
  'user.unlocked': 'Account unlocked',
  'seat_limit.reached': 'Seat limit reached',

  // Roles (ROL-006)
  'role.created': 'Role created',
  'role.updated': 'Role updated',
  'role.archived': 'Role archived',
  'role.restored': 'Role restored',

  // Organisation structure
  'site.created': 'Site created',
  'site.updated': 'Site updated',
  'site.archived': 'Site archived',
  'site.restored': 'Site restored',
  'area.created': 'Area created',
  'area.updated': 'Area updated',
  'area.archived': 'Area archived',
  'area.restored': 'Area restored',
  'team.created': 'Team created',
  'team.updated': 'Team updated',
  'team.archived': 'Team archived',
  'team.restored': 'Team restored',
  'discipline.created': 'Discipline created',
  'discipline.updated': 'Discipline updated',
  'discipline.archived': 'Discipline archived',
  'discipline.restored': 'Discipline restored',

  // Plant configuration (ADM-003)
  'plant_type.created': 'Plant type created',
  'plant_type.updated': 'Plant type updated',
  'plant_type.archived': 'Plant type archived',
  'plant_type.restored': 'Plant type restored',
  'plant_type.requirements_changed': 'Mandatory documents changed',
  'plant_category.created': 'Plant category created',
  'plant_category.updated': 'Plant category updated',
  'plant_category.archived': 'Plant category archived',
  'plant_category.restored': 'Plant category restored',
  'plant_company.created': 'Owner or hire company created',
  'plant_company.updated': 'Owner or hire company updated',
  'plant_company.archived': 'Owner or hire company archived',
  'plant_company.restored': 'Owner or hire company restored',
  'custom_field.created': 'Custom field created',
  'custom_field.updated': 'Custom field updated',
  'custom_field.archived': 'Custom field archived',
  'custom_field.restored': 'Custom field restored',
  'meter_type.created': 'Meter type created',
  'meter_type.updated': 'Meter type updated',
  'meter_type.archived': 'Meter type archived',
  'meter_type.restored': 'Meter type restored',
  'document_type.created': 'Document type created',
  'document_type.updated': 'Document type updated',
  'document_type.archived': 'Document type archived',
  'document_type.restored': 'Document type restored',

  // Plant (PLC-007, PLT-AC-03)
  'plant.created': 'Plant registered',
  'plant.updated': 'Plant details updated',
  'plant.restricted': 'Plant restricted',
  'plant.returned_to_service': 'Plant returned to service',
  'plant.archived': 'Plant archived',
  'plant.restored': 'Plant restored',
  'plant.exported': 'Plant register exported',

  // Internal provisioning (IAD-004)
  'organisation.created': 'Organisation created',
  'organisation.updated': 'Organisation updated',
  'organisation.suspended': 'Organisation suspended',
  'organisation.activated': 'Organisation activated',
  'organisation.archived': 'Organisation archived',
  'staff.login.succeeded': 'Staff signed in',
  'staff.login.failed': 'Failed staff sign-in attempt',
  'staff.account.locked': 'Staff account locked',
  'staff.logout': 'Staff signed out',
  'staff.mfa.enabled': 'Two-factor authentication enabled',
  'staff.password.changed': 'Staff password changed',
  'staff.created': 'Staff member created',
  'staff.updated': 'Staff member updated',
  'staff.password.reset': 'Staff password reset',

  // Offline sync proof of concept
  'poc.check.submitted': 'Check submitted',
  'poc.check.submission_rejected': 'Later submission rejected',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AUDIT_CATEGORIES = [
  { key: 'auth', label: 'Sign-in and sessions' },
  { key: 'user', label: 'Users' },
  { key: 'role', label: 'Roles' },
  { key: 'site', label: 'Sites' },
  { key: 'area', label: 'Areas' },
  { key: 'team', label: 'Teams' },
  { key: 'discipline', label: 'Disciplines' },
  { key: 'plant_type', label: 'Plant types' },
  { key: 'plant_category', label: 'Plant categories' },
  { key: 'plant_company', label: 'Owners and hire companies' },
  { key: 'custom_field', label: 'Custom fields' },
  { key: 'meter_type', label: 'Meter types' },
  { key: 'document_type', label: 'Document types' },
  { key: 'plant', label: 'Plant' },
  { key: 'seat_limit', label: 'Seats' },
  { key: 'organisation', label: 'Organisations' },
  { key: 'staff', label: 'CoreCheck staff' },
  { key: 'poc', label: 'Offline sync' },
] as const;

export const auditActionLabel = (action: string): string =>
  (AUDIT_ACTIONS as Record<string, string>)[action] ?? action;
