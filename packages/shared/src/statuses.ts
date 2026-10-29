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

// ------------------------------------------------------------------ plant

/**
 * The primary plant lifecycle (PLC-001). Archived is shown as a status too,
 * but is held separately so restoring returns plant to where it was.
 */
export const PLANT_STATUSES = [
  'pending_reception',
  'awaiting_approval',
  'approved',
  'restricted',
] as const;
export type PlantStatus = (typeof PLANT_STATUSES)[number];

export const PLANT_STATUS_LABELS: Record<PlantStatus | 'archived', string> = {
  pending_reception: 'Pending Reception',
  awaiting_approval: 'Awaiting Approval',
  approved: 'Approved/Online',
  restricted: 'Restricted/Offline',
  archived: 'Archived',
};

/** Operational classifications of restricted plant, never statuses (PLC-002). */
export const RESTRICTION_REASONS = [
  'quarantined',
  'not_in_use',
  'off_hired',
] as const;
export type RestrictionReason = (typeof RESTRICTION_REASONS)[number];

export const RESTRICTION_REASON_LABELS: Record<RestrictionReason, string> = {
  quarantined: 'Quarantined',
  not_in_use: 'Not in Use',
  off_hired: 'Off-hired',
};

export const PLANT_OWNERSHIPS = ['owned', 'hired'] as const;
export type PlantOwnership = (typeof PLANT_OWNERSHIPS)[number];

export const PLANT_OWNERSHIP_LABELS: Record<PlantOwnership, string> = {
  owned: 'Owned',
  hired: 'Hired',
};

/** The company kind each ownership type names (PLT-006). */
export const OWNERSHIP_COMPANY_KIND: Record<PlantOwnership, PlantCompanyKind> =
  {
    owned: 'owner',
    hired: 'hire_company',
  };

// -------------------------------------------------------------- documents

/** Document statuses (DOC-005). Missing applies to a required type with none. */
export const DOCUMENT_STATES = [
  'missing',
  'awaiting_verification',
  'valid',
  'approaching_expiry',
  'expired',
  'rejected',
  'archived',
] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

export const DOCUMENT_STATE_LABELS: Record<DocumentState, string> = {
  missing: 'Missing',
  awaiting_verification: 'Awaiting Verification',
  valid: 'Valid',
  approaching_expiry: 'Approaching Expiry',
  expired: 'Expired',
  rejected: 'Rejected',
  archived: 'Archived',
};

/** States in which a document satisfies a mandatory requirement. */
export const COMPLIANT_DOCUMENT_STATES: readonly DocumentState[] = [
  'valid',
  'approaching_expiry',
];

export const DOCUMENT_VERIFICATIONS = [
  'awaiting',
  'verified',
  'rejected',
] as const;
export type DocumentVerification = (typeof DOCUMENT_VERIFICATIONS)[number];

/** A plant's standing against its mandatory documents (PLR-001). */
export const PLANT_COMPLIANCE_STATES = [
  'compliant',
  'expiring',
  'non_compliant',
  'not_required',
] as const;
export type PlantComplianceState = (typeof PLANT_COMPLIANCE_STATES)[number];

export const PLANT_COMPLIANCE_LABELS: Record<PlantComplianceState, string> = {
  compliant: 'Documents valid',
  expiring: 'Documents expiring',
  non_compliant: 'Documents not valid',
  not_required: 'No documents required',
};

/** Largest accepted document file, in bytes (NFR-003 upload size). */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
