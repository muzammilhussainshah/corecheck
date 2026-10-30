import type { ErrorCode } from './errors.js';
import type { PermissionCode } from './permissions.js';
import type { PocCheckStatus, PocQuestionKey } from './poc.js';
import type { AnswerValue, TemplateQuestion } from './reception.js';
import type { StandardRoleKey } from './roles.js';
import type {
  ApprovalMode,
  ClientType,
  CustomFieldType,
  DocumentState,
  DocumentVerification,
  OrganisationStatus,
  PlantComplianceState,
  PlantCompanyKind,
  PlantOwnership,
  PlantStatus,
  ReceptionStatus,
  RestrictionReason,
  StaffRole,
  StaffStatus,
  TemplatePurpose,
  UserStatus,
} from './statuses.js';

/** Response shapes of the API. Dates are ISO strings. */

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IdName {
  id: string;
  name: string;
}

// ------------------------------------------------------ customer session

export interface MeResponse {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
    email: string | null;
  };
  organisation: {
    id: string;
    name: string;
    timeZone: string;
    status: OrganisationStatus;
    expiresOn: string;
    /** Past the account expiry date: sign-in works, changes do not (IAD-007). */
    readOnly: boolean;
  };
  role: {
    id: string;
    name: string;
    standardKey: StandardRoleKey | null;
    orgWideScope: boolean;
    privileged: boolean;
  };
  permissions: PermissionCode[];
  scope: {
    orgWide: boolean;
    siteIds: string[];
    teamIds: string[];
    disciplineIds: string[];
  };
  mustChangePin: boolean;
  session: {
    client: ClientType;
    expiresAt: string;
    idleTimeoutSeconds: number;
  };
}

export interface LoginResponse {
  me: MeResponse;
  /** Bearer token, returned to the mobile app only; web uses a cookie. */
  token?: string;
}

// ------------------------------------------------------------------ users

export interface UserRoleRef extends IdName {
  standardKey: StandardRoleKey | null;
}

export interface UserSummary {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string | null;
  status: UserStatus;
  role: UserRoleRef;
  sites: IdName[];
  teams: IdName[];
  disciplines: IdName[];
  lastLoginAt: string | null;
  createdAt: string;
  capabilities: UserCapabilities;
}

/** What the signed-in user may do to this user, so the UI can hide the rest. */
export interface UserCapabilities {
  canEdit: boolean;
  canChangeRole: boolean;
  canAssignScope: boolean;
  canResetPin: boolean;
  canUnlock: boolean;
  canDeactivate: boolean;
  canReactivate: boolean;
}

export interface UserDetail extends UserSummary {
  mustChangePin: boolean;
  failedPinAttempts: number;
  lockedAt: string | null;
}

/** Shown once, to the person who created or reset the account. */
export interface IssuedCredentials {
  username: string;
  temporaryPin: string;
  expiresAt: string;
}

export interface UserWithCredentials {
  user: UserDetail;
  credentials: IssuedCredentials;
}

export interface SeatUsage {
  limit: number;
  used: number;
  available: number;
}

// ------------------------------------------------------------------ roles

export interface RoleSummary {
  id: string;
  name: string;
  description: string;
  standardKey: StandardRoleKey | null;
  isStandard: boolean;
  orgWideScope: boolean;
  privileged: boolean;
  permissions: PermissionCode[];
  activeUserCount: number;
  archivedAt: string | null;
  /** The signed-in user may give this role to someone. */
  assignable: boolean;
}

// ------------------------------------------------- organisation structure

export interface Site {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  archivedAt: string | null;
  areaCount: number;
}

export interface Area {
  id: string;
  siteId: string;
  name: string;
  archivedAt: string | null;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  memberCount: number;
}

export interface Discipline {
  id: string;
  name: string;
  archivedAt: string | null;
  memberCount: number;
}

// ---------------------------------------------------- plant configuration

export interface PlantType {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  /** Document types a plant of this type must hold (DOC-001). */
  requiredDocumentTypeIds: string[];
}

export interface PlantCategory {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
}

export interface PlantCompany {
  id: string;
  kind: PlantCompanyKind;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  archivedAt: string | null;
}

export interface CustomField {
  id: string;
  label: string;
  fieldType: CustomFieldType;
  /** The choices of a choice-list field; empty for other types. */
  options: string[];
  required: boolean;
  sortOrder: number;
  archivedAt: string | null;
}

export interface MeterType {
  id: string;
  name: string;
  unit: string;
  archivedAt: string | null;
}

export interface DocumentType {
  id: string;
  name: string;
  description: string | null;
  hasExpiry: boolean;
  /** Days before expiry that a document shows Approaching Expiry (DOC-005). */
  warningDays: number;
  archivedAt: string | null;
}

// ------------------------------------------------------------------ plant

/** A row of the Plant Register (PLR-001). */
export interface PlantSummary {
  id: string;
  /** System Asset ID: the one unique plant identifier (PLT-001). */
  assetId: string;
  plantNumber: string | null;
  serialNumber: string | null;
  name: string;
  plantType: IdName;
  category: IdName | null;
  make: string | null;
  model: string | null;
  ownership: PlantOwnership;
  company: IdName;
  site: IdName;
  area: IdName | null;
  status: PlantStatus;
  restrictionReason: RestrictionReason | null;
  /** Standing against the plant type's mandatory documents (PLR-001). */
  compliance: PlantComplianceState;
  archivedAt: string | null;
  updatedAt: string;
}

/** A custom field value: text, date (YYYY-MM-DD), number or a choice. */
export type CustomValue = string | number;

export interface PlantDetail extends PlantSummary {
  disciplines: IdName[];
  /** Keyed by custom field id (PLT-008). */
  customValues: Record<string, CustomValue>;
  statusNote: string | null;
  statusChangedAt: string;
  statusChangedBy: string | null;
  /** Last approval; never-approved plant returns to Pending Reception. */
  approvedAt: string | null;
  /** An override of missing documents still within its review date. */
  complianceOverride: { until: string; note: string } | null;
  createdAt: string;
  createdBy: string;
  /** What the signed-in user may do with this plant. */
  capabilities: {
    edit: boolean;
    /** Change the System Asset ID or move the plant to another site. */
    editIdentifiers: boolean;
    archive: boolean;
    restrict: boolean;
    returnToService: boolean;
    printQr: boolean;
  };
}

/** Saved plant, with any possible duplicates to show the user (PLT-004). */
export interface PlantSaved {
  plant: PlantDetail;
  duplicates: PlantDuplicates;
}

// -------------------------------------------------------------- documents

/** One upload of a document; replacing a document adds a version (DOC-007). */
export interface DocumentVersion {
  id: string;
  version: number;
  reference: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  verification: DocumentVerification;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
}

export interface PlantDocument {
  id: string;
  plantId: string;
  documentType: IdName & { hasExpiry: boolean };
  /** Worked out from the current version and today's date (DOC-005). */
  state: Exclude<DocumentState, 'missing'>;
  /** Newest first; the first is the current version. */
  versions: DocumentVersion[];
  archivedAt: string | null;
  capabilities: { replace: boolean; verify: boolean; archive: boolean };
}

/** A mandatory document of the plant's type and how the plant stands on it. */
export interface DocumentRequirement {
  documentType: IdName;
  state: DocumentState;
}

export interface PlantCompliance {
  state: PlantComplianceState;
  requirements: DocumentRequirement[];
  /** An authorised override keeping plant in use until the review date. */
  override: { until: string; note: string; by: string | null } | null;
}

export interface PlantDocuments {
  compliance: PlantCompliance;
  documents: PlantDocument[];
  capabilities: { upload: boolean };
}

/** A row of the Documents register across all plant in scope. */
export interface DocumentRegisterRow {
  id: string;
  plant: { id: string; assetId: string; name: string; site: IdName };
  documentType: IdName;
  state: Exclude<DocumentState, 'missing'>;
  reference: string | null;
  expiresOn: string | null;
  uploadedAt: string;
}

/** Plant sharing a Plant Number or Serial Number; a warning, never a block. */
export interface PlantDuplicates {
  plantNumber: PlantSummary[];
  serialNumber: PlantSummary[];
  /** Further matches at sites the user cannot see. */
  outsideScope: number;
}

// ------------------------------------------------------------------ audit

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorType: 'user' | 'staff' | 'system';
  actorName: string | null;
  organisationName?: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

// ------------------------------------------------ internal staff portal

export interface StaffMe {
  id: string;
  name: string;
  email: string;
  staffRole: StaffRole;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  mustChangePassword: boolean;
}

export interface StaffLoginResponse {
  staff: StaffMe;
  /** The second factor the session needs, or done when none is required. */
  next: 'mfa_setup' | 'mfa_verify' | 'done';
}

export interface MfaSetupResponse {
  otpauthUrl: string;
  qrCodeDataUrl: string;
  /** For entering by hand when the QR code cannot be scanned. */
  secret: string;
}

export interface OrganisationUsage {
  activeUsers: number;
  lockedUsers: number;
  inactiveUsers: number;
  seatsUsed: number;
  /** Uploaded files and their total size; counts only, never the files. */
  storedFiles: number;
  storageBytes: number;
}

export interface OrganisationSummary {
  id: string;
  name: string;
  industry: string;
  country: string;
  status: OrganisationStatus;
  seatLimit: number;
  seatsUsed: number;
  startsOn: string;
  expiresOn: string;
  /** Today, in the organisation's time zone, is after the expiry date. */
  expired: boolean;
  createdAt: string;
}

export interface OrganisationDetail extends OrganisationSummary {
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  timeZone: string;
  usage: OrganisationUsage;
}

export interface OrganisationAdmin {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  status: UserStatus;
  lastLoginAt: string | null;
}

export interface CreateOrganisationResponse {
  organisation: OrganisationDetail;
  firstAdmin: OrganisationAdmin;
  credentials: IssuedCredentials;
}

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  staffRole: StaffRole;
  status: StaffStatus;
  locked: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface StaffWithPassword {
  staff: StaffMember;
  /** Shown once; the staff member must change it at first sign-in. */
  temporaryPassword: string;
}

// ------------------------------------------------ offline sync (PoC)

export interface PocAnswer {
  questionKey: PocQuestionKey;
  value: string;
  answeredBy: IdName;
  answeredAt: string;
}

export interface PocEvidence {
  id: string;
  questionKey: PocQuestionKey;
  uploadedBy: IdName;
  capturedAt: string;
  contentType: string;
  sizeBytes: number;
}

export interface PocCheck {
  id: string;
  title: string;
  plantLabel: string;
  site: IdName;
  status: PocCheckStatus;
  submittedBy: IdName | null;
  submittedAt: string | null;
  answers: PocAnswer[];
  evidence: PocEvidence[];
  updatedAt: string;
}

export interface PocPullResponse {
  serverTime: string;
  /** Everything the user may currently work on; anything else is removed locally. */
  checks: PocCheck[];
}

export type PocMutationResult =
  | { id: string; status: 'applied' | 'duplicate' }
  | {
      id: string;
      status: 'rejected';
      code: ErrorCode;
      message: string;
      details?: Record<string, unknown>;
    };

export interface PocPushResponse {
  results: PocMutationResult[];
}

// ------------------------------------------------- templates and reception

export interface TemplateVersionDetail {
  id: string;
  version: number;
  state: 'draft' | 'published';
  approvalMode: ApprovalMode;
  questions: TemplateQuestion[];
  publishedAt: string | null;
  publishedBy: string | null;
}

export interface CheckTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  purpose: TemplatePurpose;
  /** The version new checks use; null until first published. */
  publishedVersion: number | null;
  hasDraft: boolean;
  questionCount: number;
  archivedAt: string | null;
  updatedAt: string;
}

export interface CheckTemplateDetail extends CheckTemplateSummary {
  draft: TemplateVersionDetail | null;
  published: TemplateVersionDetail | null;
  versions: Array<{
    version: number;
    state: 'draft' | 'published';
    publishedAt: string | null;
    publishedBy: string | null;
  }>;
}

export interface ReceptionAnswer {
  questionId: string;
  value: AnswerValue;
  comment: string | null;
  answeredBy: string;
  answeredAt: string;
}

export interface ReceptionEvidence {
  id: string;
  questionId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
}

/** A submission as it was sent, kept when the check is returned (REC-AC-04). */
export interface ReceptionSubmission {
  id: string;
  submittedBy: string;
  submittedAt: string;
  outcome: 'awaiting_approval' | 'approved' | 'restricted';
  outcomeReasons: string[];
  answers: ReceptionAnswer[];
}

export interface ReceptionCheck {
  id: string;
  plantId: string;
  status: ReceptionStatus;
  template: {
    id: string;
    name: string;
    version: number;
    approvalMode: ApprovalMode;
  };
  /** The questions of the version this check started from (REC-008). */
  questions: TemplateQuestion[];
  answers: ReceptionAnswer[];
  evidence: ReceptionEvidence[];
  submissions: ReceptionSubmission[];
  assignedBy: string;
  assignedAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  outcomeReasons: string[];
  capabilities: {
    answer: boolean;
    submit: boolean;
    approve: boolean;
    returnForCorrection: boolean;
    cancel: boolean;
  };
}

export interface PlantReception {
  /** The reception in progress, or the latest finished one. */
  current: ReceptionCheck | null;
  history: Array<{
    id: string;
    status: ReceptionStatus;
    templateName: string;
    version: number;
    assignedAt: string;
    submittedAt: string | null;
    reviewedAt: string | null;
  }>;
  capabilities: { assign: boolean };
}

// --------------------------------------------------------- meter readings

export interface MeterReading {
  id: string;
  meterType: IdName;
  /** The current value, after any corrections. */
  value: number;
  unit: string;
  readAt: string;
  source: 'manual' | 'reception';
  recordedBy: string;
  /** Newest first; each keeps the value it replaced (MTR-005). */
  corrections: Array<{
    previousValue: number;
    newValue: number;
    reason: string;
    correctedBy: string;
    correctedAt: string;
  }>;
  canCorrect: boolean;
}

export interface PlantMeters {
  /** The newest reading of each meter. */
  latest: MeterReading[];
  /** Every reading, newest first (MTR-006). */
  readings: MeterReading[];
  capabilities: { record: boolean };
}
