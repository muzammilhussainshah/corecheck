import type { ErrorCode } from './errors.js';
import type { PermissionCode } from './permissions.js';
import type { ImportRowStatus } from './plant-import.js';
import type { TemplateImportRowStatus } from './template-import.js';
import type { PocCheckStatus, PocQuestionKey } from './poc.js';
import type { AnswerValue, TemplateQuestion } from './reception.js';
import type {
  TemplateEligibility,
  TemplateRecurrence,
} from './schemas.js';
import type { StandardRoleKey } from './roles.js';
import type {
  ApprovalMode,
  CheckDisplayStatus,
  CheckSource,
  CheckStatus,
  ClientType,
  DefectSeverity,
  DefectStatus,
  NotificationKind,
  ScheduleBasis,
  ScheduleFrequency,
  ScheduleState,
  ScheduleUnit,
  SeparationRule,
  VerificationState,
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
  /**
   * Open Defects raised by a question that took the plant Offline: returning
   * it to service needs them closed or an authorised override (DFW-009).
   */
  blockingDefects: Array<{
    id: string;
    ref: string;
    severity: DefectSeverity;
    questionText: string;
  }>;
  /** Open and in-progress Defects on this plant. */
  openDefects: number;
  /** An override of missing documents still within its review date. */
  complianceOverride: { until: string; note: string } | null;
  /**
   * Passed reception but held Restricted/Offline until its mandatory
   * documents and required details are in order and the reception is
   * approved (DOC-004, REC-AC-02). Approval, not a return to service,
   * brings it Online.
   */
  heldByReception: boolean;
  /**
   * While held: what still stops approval, worked out now (documents not
   * valid, required details missing). Empty once all is in order.
   */
  receptionBlockers: string[];
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
    /** Return to service despite an open Defect (DFW-009). */
    overrideDefects: boolean;
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
  /** Not verified yet, whatever the state (it may also have expired). */
  awaitingVerification: boolean;
  /** Within the type's warning days: a warning beside the state. */
  expiresSoon: boolean;
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
  /** Not verified yet, whatever the state (it may also have expired). */
  awaitingVerification: boolean;
  /** Within the type's warning days: a warning beside the state. */
  expiresSoon: boolean;
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
  /** Plant not archived; a total only, never the records. */
  plants: number;
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
  /** manual: completion and approval are separate (TMP-011). */
  approvalMode: ApprovalMode;
  questions: TemplateQuestion[];
  eligibility: TemplateEligibility;
  separation: SeparationRule;
  requireCorrectiveAction: boolean;
  requireRepairEvidence: boolean;
  recurrence: TemplateRecurrence | null;
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
  /** Checks not yet started on an earlier version (TMP-005). */
  unstartedChecks: number;
  /** Active schedules using this template. */
  schedules: number;
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
  /** Why it was held, as recorded at submission; kept as history. */
  outcomeReasons: string[];
  /**
   * While awaiting approval: what stops approval now, worked out afresh
   * (Milestone 2 bug 8). Null otherwise. Empty means ready to approve.
   */
  currentBlockers: string[] | null;
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
  source: 'manual' | 'reception' | 'check';
  /** The check it came from, when source is check. */
  check: { id: string; ref: string } | null;
  recordedBy: string;
  /** Why it is below the latest reading before it (meter replaced or reset). */
  resetReason: string | null;
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

// ---------------------------------------------------------- plant import

export interface PlantImportSummary {
  id: string;
  fileName: string;
  createdBy: string;
  createdAt: string;
  counts: Record<ImportRowStatus, number>;
}

export interface PlantImportRow {
  id: string;
  /** The row in the uploaded spreadsheet. */
  rowNumber: number;
  /** Values by column key; custom fields are "custom:<id>". */
  data: Record<string, string>;
  status: ImportRowStatus;
  problems: string[];
  warnings: string[];
  confirmed: boolean;
  /** The plant whose System Asset ID this row repeats. */
  existingPlant: { id: string; assetId: string; name: string } | null;
  /** Plant with the same Plant Number or Serial Number (IPL-005). */
  matches: Array<{ id: string; assetId: string; name: string }>;
  /** The plant this row created. */
  plant: { id: string; assetId: string; name: string } | null;
}

export interface PlantImportDetail extends PlantImportSummary {
  columns: Array<{ key: string; label: string; required: boolean }>;
  rows: PlantImportRow[];
}

// ------------------------------------------------- schedules and checks

export interface CheckAssignee {
  user: IdName | null;
  team: IdName | null;
  discipline: IdName | null;
}

export interface PlantRef {
  id: string;
  assetId: string;
  name: string;
  status: PlantStatus;
  site: IdName;
}

export interface CheckSchedule {
  id: string;
  name: string;
  template: IdName & { purpose: TemplatePurpose };
  plant: PlantRef;
  frequency: ScheduleFrequency;
  customUnit: ScheduleUnit | null;
  customCount: number | null;
  /** e.g. "Every 6 weeks". */
  recurrence: string;
  basis: ScheduleBasis;
  startOn: string;
  nextDueOn: string;
  requiresApproval: boolean;
  assignee: CheckAssignee;
  state: ScheduleState;
  pauseReason: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
  /** The generated check waiting to be done, if any. */
  openCheck: {
    id: string;
    ref: string;
    status: CheckDisplayStatus;
    dueOn: string | null;
  } | null;
  lastCompletedAt: string | null;
  createdBy: string;
  createdAt: string;
  capabilities: { edit: boolean; pause: boolean; resume: boolean; end: boolean };
}

export interface CheckSummary {
  id: string;
  /** CHK-000001 */
  ref: string;
  plant: PlantRef;
  template: IdName & { purpose: TemplatePurpose; version: number };
  source: CheckSource;
  status: CheckStatus;
  /** Status as shown, with Overdue worked out in the organisation time zone. */
  displayStatus: CheckDisplayStatus;
  overdue: boolean;
  availableOn: string | null;
  dueOn: string | null;
  assignee: CheckAssignee;
  requiresReview: boolean;
  schedule: IdName | null;
  defect: { id: string; ref: string } | null;
  startedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface CheckAnswer {
  questionId: string;
  value: AnswerValue;
  comment: string | null;
  answeredBy: string;
  answeredAt: string;
}

export interface CheckEvidence {
  id: string;
  questionId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
}

/** One change to an answer; the first is the answer as first given. */
export interface CheckAnswerChange {
  questionId: string;
  previousValue: AnswerValue;
  previousComment: string | null;
  value: AnswerValue;
  comment: string | null;
  changedBy: string;
  changedAt: string;
  afterSubmission: boolean;
  reason: string | null;
}

export interface CheckSubmission {
  id: string;
  submittedBy: string;
  submittedAt: string;
  outcome: 'awaiting_review' | 'completed';
  outcomeReasons: string[];
  answers: CheckAnswer[];
}

export interface CheckDetail extends CheckSummary {
  /** The questions of the version this check uses (CHK-002). */
  questions: TemplateQuestion[];
  answers: CheckAnswer[];
  evidence: CheckEvidence[];
  changes: CheckAnswerChange[];
  submissions: CheckSubmission[];
  /** Everyone who answered, changed or added evidence, and to what (EVD-003). */
  contributors: Array<{ name: string; questionIds: string[] }>;
  createdBy: string | null;
  createdAt: string;
  startedBy: string | null;
  submittedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  reviewOverrideReason: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  outcomeReasons: string[];
  separationRequired: boolean;
  defectsRaised: Array<{
    id: string;
    ref: string;
    questionId: string;
    severity: DefectSeverity;
    status: DefectStatus;
  }>;
  /** Why this user cannot approve, e.g. separation of duties. */
  reviewBlock: string | null;
  /** Assignments, reschedules, reviews and other events (CHK-002). */
  history: AuditEvent[];
  capabilities: {
    answer: boolean;
    submit: boolean;
    review: boolean;
    /** Approve despite the separation block, with a reason (DFW-009). */
    override: boolean;
    reopen: boolean;
    editSubmitted: boolean;
    cancel: boolean;
    assign: boolean;
    reschedule: boolean;
    export: boolean;
  };
}

// ---------------------------------------------------------------- defects

export interface DefectSummary {
  id: string;
  /** DEF-000001 */
  ref: string;
  plant: PlantRef;
  severity: DefectSeverity;
  status: DefectStatus;
  questionText: string;
  raisedBy: string;
  raisedAt: string;
  assignee: IdName | null;
  verification: VerificationState;
  restrictsPlant: boolean;
  source: { kind: 'check' | 'reception'; id: string; ref: string | null };
  updatedAt: string;
}

export interface DefectEvidence {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface DefectDetail extends DefectSummary {
  answer: AnswerValue;
  answerComment: string | null;
  /** The evidence given with the failed answer. */
  sourceEvidence: CheckEvidence[];
  correctiveAction: string | null;
  repairNotes: string | null;
  workRecordedBy: string | null;
  workRecordedAt: string | null;
  evidence: DefectEvidence[];
  verificationCheck: CheckSummary | null;
  /** Published verification templates that apply to this plant. */
  verificationTemplates: IdName[];
  /** What the verification template makes mandatory (DFW-003). */
  requireCorrectiveAction: boolean;
  requireRepairEvidence: boolean;
  startedBy: string | null;
  startedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  closeNote: string | null;
  reopenedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  /** What still stops closing it (DFW-010). */
  closeBlockers: string[];
  history: AuditEvent[];
  capabilities: {
    assign: boolean;
    start: boolean;
    recordWork: boolean;
    startVerification: boolean;
    close: boolean;
    reopen: boolean;
  };
}

// --------------------------------------------------------- notifications

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationList {
  items: NotificationItem[];
  unread: number;
}

/** Work counts for the dashboard, within the user's scope. */
export interface WorkSummary {
  checks: {
    mine: number;
    due: number;
    overdue: number;
    inProgress: number;
    awaitingReview: number;
  };
  defects: {
    open: number;
    inProgress: number;
    critical: number;
    assignedToMe: number;
  };
}

// -------------------------------------------------- check template import

export interface TemplateImportSummary {
  id: string;
  fileName: string;
  createdBy: string;
  createdAt: string;
  counts: Record<TemplateImportRowStatus, number>;
  /** Templates the file holds, and how many were created as Drafts. */
  templates: number;
  imported: number;
}

export interface TemplateImportRow {
  id: string;
  rowNumber: number;
  /** Values by column key. */
  data: Record<string, string>;
  status: TemplateImportRowStatus;
  problems: string[];
}

export interface TemplateImportGroup {
  name: string;
  /** A template is created only when every one of its rows is ready. */
  status: TemplateImportRowStatus;
  rowNumbers: number[];
  questions: number;
  template: IdName | null;
}

export interface TemplateImportDetail extends TemplateImportSummary {
  columns: Array<{ key: string; label: string; required: boolean }>;
  rows: TemplateImportRow[];
  groups: TemplateImportGroup[];
}

// -------------------------------------------------------------- dashboard

/**
 * The dashboard (FRD 6) within the user's scope; a section is null when the
 * user may not see that kind of record. Dates are in the organisation's
 * time zone (DSH-AC-03).
 */
export interface DashboardSummary {
  period: { today: string; weekEnd: string; monthEnd: string; recentFrom: string };
  plant: {
    pendingReception: number;
    awaitingApproval: number;
    online: number;
    offline: number;
  } | null;
  /**
   * Plant whose mandatory documents are missing, expired or not valid (the
   * register's "Documents not valid" filter), and documents expired or
   * approaching expiry (the Documents page filters).
   */
  documents: {
    plantNotValid: number;
    expired: number;
    approachingExpiry: number;
  } | null;
  checks: {
    mine: number;
    dueToday: number;
    dueThisWeek: number;
    dueThisMonth: number;
    overdue: number;
    awaitingReview: number;
    failedRecently: number;
    raisedDefectsRecently: number;
  } | null;
  recentlyCompleted: Array<{
    id: string;
    ref: string;
    plant: { id: string; assetId: string; name: string };
    template: string;
    purpose: TemplatePurpose;
    completedBy: string;
    completedAt: string;
    failures: number;
  }>;
  defects: {
    minor: number;
    major: number;
    critical: number;
    assignedToMe: number;
  } | null;
  statusChanges: Array<{
    plant: { id: string; assetId: string; name: string };
    action: string;
    summary: string;
    by: string | null;
    at: string;
  }>;
}
