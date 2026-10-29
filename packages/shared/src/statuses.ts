/**
 * Status values and their display labels. Web and mobile both read the labels
 * from here so the same record never shows two different names (NAV-005).
 */

export const USER_STATUSES = ['active', 'inactive', 'locked'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  locked: 'Locked',
};

/** Statuses that occupy a licensed seat (IAD-005). */
export const SEAT_HOLDING_USER_STATUSES: readonly UserStatus[] = [
  'active',
  'locked',
];

export const ORGANISATION_STATUSES = [
  'active',
  'suspended',
  'archived',
] as const;
export type OrganisationStatus = (typeof ORGANISATION_STATUSES)[number];

export const ORGANISATION_STATUS_LABELS: Record<OrganisationStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
  archived: 'Archived',
};

export const STAFF_ROLES = ['owner', 'admin', 'support'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  support: 'Support',
};

export const STAFF_ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  owner: 'Everything, including managing CoreCheck staff.',
  admin:
    'Create and manage organisations, seats, dates and Organisation Admins.',
  support: 'View organisations, usage and the provisioning audit trail.',
};

export const STAFF_STATUSES = ['active', 'disabled'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

/** Which app a customer session belongs to; drives session lifetime. */
export const CLIENT_TYPES = ['web', 'mobile'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

// ------------------------------------------------- plant configuration

/** Owned plant names its owner; hired plant names its hire company (PLT-006). */
export const PLANT_COMPANY_KINDS = ['owner', 'hire_company'] as const;
export type PlantCompanyKind = (typeof PLANT_COMPANY_KINDS)[number];

export const PLANT_COMPANY_KIND_LABELS: Record<PlantCompanyKind, string> = {
  owner: 'Owner',
  hire_company: 'Hire company',
};

/** Value types an Admin can give a plant custom field (PLT-008). */
export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'select'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Choice list',
};
