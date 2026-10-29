/**
 * Machine-readable error codes returned by the API. Clients branch on the
 * code, never on the message text.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  FORBIDDEN: 'FORBIDDEN',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** The API is up but cannot reach its database (network or DNS). */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Authentication
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  TEMPORARY_PIN_EXPIRED: 'TEMPORARY_PIN_EXPIRED',
  PIN_CHANGE_REQUIRED: 'PIN_CHANGE_REQUIRED',
  WEAK_PIN: 'WEAK_PIN',
  PIN_REUSED: 'PIN_REUSED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_REPLACED: 'SESSION_REPLACED',
  SESSION_REVOKED: 'SESSION_REVOKED',

  // Organisation state
  ORG_SUSPENDED: 'ORG_SUSPENDED',
  ORG_ARCHIVED: 'ORG_ARCHIVED',
  ORG_NOT_STARTED: 'ORG_NOT_STARTED',
  ORG_READ_ONLY: 'ORG_READ_ONLY',
  SEAT_LIMIT_REACHED: 'SEAT_LIMIT_REACHED',

  // Users and roles
  LAST_ADMIN: 'LAST_ADMIN',
  SELF_ACTION: 'SELF_ACTION',
  PRIVILEGED_ROLE: 'PRIVILEGED_ROLE',
  ROLE_IN_USE: 'ROLE_IN_USE',
  STANDARD_ROLE_LOCKED: 'STANDARD_ROLE_LOCKED',
  ARCHIVED_REFERENCE: 'ARCHIVED_REFERENCE',

  // Internal staff
  MFA_SETUP_REQUIRED: 'MFA_SETUP_REQUIRED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  INVALID_MFA_CODE: 'INVALID_MFA_CODE',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  LAST_OWNER: 'LAST_OWNER',

  // Offline sync
  ALREADY_SUBMITTED: 'ALREADY_SUBMITTED',

  // Plant
  /** Mandatory documents missing or expired; an authorised override can pass it. */
  DOCUMENTS_NOT_VALID: 'DOCUMENTS_NOT_VALID',
  INCOMPLETE_SUBMISSION: 'INCOMPLETE_SUBMISSION',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface FieldError {
  /** Dotted path of the offending field, e.g. "firstAdmin.lastName". */
  field: string;
  message: string;
}

/** Body of every non-2xx API response. */
export interface ApiError {
  statusCode: number;
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldError[];
  details?: Record<string, unknown>;
  /** Quote this to support; it ties the response to the server log entry. */
  requestId?: string;
}
