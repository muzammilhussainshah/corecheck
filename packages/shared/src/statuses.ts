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

// ------------------------------------------------- templates and reception

/** What a check template is for (TMP-009). Milestone 3 adds the others. */
export const TEMPLATE_PURPOSES = ['reception'] as const;
export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number];

/** Whether a passed reception goes straight Online (REC-004). */
export const APPROVAL_MODES = ['automatic', 'manual'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  automatic: 'Automatic approval when every rule passes',
  manual: 'Manual approval by a Supervisor, Manager or Admin',
};

export const QUESTION_TYPES = [
  'pass_fail',
  'yes_no',
  'text',
  'number',
  'photo',
  'meter',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  pass_fail: 'Pass / fail',
  yes_no: 'Yes / no',
  text: 'Text',
  number: 'Number',
  photo: 'Photo',
  meter: 'Meter reading',
};

/** When a comment or photo must go with an answer (TMP-011). */
export const EVIDENCE_RULES = ['never', 'on_fail', 'always'] as const;
export type EvidenceRule = (typeof EVIDENCE_RULES)[number];

export const EVIDENCE_RULE_LABELS: Record<EvidenceRule, string> = {
  never: 'Optional',
  on_fail: 'Required on a fail',
  always: 'Always required',
};

export const DEFECT_SEVERITIES = ['minor', 'major', 'critical'] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

export const DEFECT_SEVERITY_LABELS: Record<DefectSeverity, string> = {
  minor: 'Minor',
  major: 'Major',
  critical: 'Critical',
};

export const RECEPTION_STATUSES = [
  'open',
  'returned',
  'submitted',
  'approved',
  'restricted',
  'cancelled',
] as const;
export type ReceptionStatus = (typeof RECEPTION_STATUSES)[number];

export const RECEPTION_STATUS_LABELS: Record<ReceptionStatus, string> = {
  open: 'In progress',
  returned: 'Returned for correction',
  submitted: 'Awaiting approval',
  approved: 'Approved',
  restricted: 'Restricted',
  cancelled: 'Cancelled',
};
