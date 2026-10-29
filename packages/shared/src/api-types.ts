import type { ErrorCode } from './errors.js';
import type { PermissionCode } from './permissions.js';
import type { PocCheckStatus, PocQuestionKey } from './poc.js';
import type { StandardRoleKey } from './roles.js';
import type {
  ClientType,
  CustomFieldType,
  OrganisationStatus,
  PlantCompanyKind,
  StaffRole,
  StaffStatus,
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
