import { z } from 'zod';
import { isPermissionCode } from './permissions.js';
import { newPinProblem, PIN_PATTERN } from './pin.js';
import { POC_QUESTION_KEYS } from './poc.js';
import { CLIENT_TYPES, STAFF_ROLES, USER_STATUSES } from './statuses.js';

/**
 * Request validation shared by the API (which enforces it) and the apps
 * (which use it to validate forms before submitting, VAL-001).
 */

// ---------------------------------------------------------------- helpers

const requiredText = (label: string, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .optional();

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email must be 254 characters or fewer.')
  .pipe(z.email('Enter a valid email address.'));

/** Email that may be left blank; blank becomes undefined. */
const optionalEmail = z
  .union([z.literal(''), email])
  .optional()
  .transform((value) => value || undefined);

const id = z.uuid('Invalid identifier.');

/** An id the user picks in a form; blank gets a "<label> is required." message. */
const requiredId = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .min(1, `${label} is required.`)
    .pipe(id);

/** A list of ids with duplicates removed. */
const idList = z
  .array(id)
  .max(500)
  .transform((ids) => [...new Set(ids)]);

const isoDate = z.iso.date('Enter a date as YYYY-MM-DD.');

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
};

/** Query-string boolean: only the literal strings "true" and "false". */
const booleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const sortOrder = z.enum(['asc', 'desc']).default('asc');

// ------------------------------------------------------ customer sign-in

const pinField = z
  .string({ error: 'Enter your 6-digit PIN.' })
  .regex(PIN_PATTERN, 'Your PIN is 6 digits.');

const newPinField = z.string().superRefine((pin, ctx) => {
  const problem = newPinProblem(pin);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

export const customerLoginSchema = z.object({
  username: z
    .string({ error: 'Enter your username.' })
    .trim()
    .toLowerCase()
    .min(1, 'Enter your username.')
    .max(64),
  pin: pinField,
  client: z.enum(CLIENT_TYPES).default('web'),
});
export type CustomerLoginInput = z.input<typeof customerLoginSchema>;

export const changePinSchema = z
  .object({
    currentPin: pinField,
    newPin: newPinField,
  })
  .refine((data) => data.newPin !== data.currentPin, {
    path: ['newPin'],
    message: 'Choose a PIN different from your current one.',
  });
export type ChangePinInput = z.input<typeof changePinSchema>;

// ------------------------------------------------------------------ users

export const createUserSchema = z.object({
  firstName: requiredText('First name', 60),
  lastName: requiredText('Last name', 60),
  email: optionalEmail,
  roleId: requiredId('Role'),
  siteIds: idList.default([]),
  teamIds: idList.default([]),
  disciplineIds: idList.default([]),
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z.object({
  firstName: requiredText('First name', 60).optional(),
  lastName: requiredText('Last name', 60).optional(),
  /** null clears the email address. */
  email: z
    .union([z.literal(''), email])
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value)),
  roleId: id.optional(),
  siteIds: idList.optional(),
  teamIds: idList.optional(),
  disciplineIds: idList.optional(),
});
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const USER_SORT_FIELDS = [
  'name',
  'username',
  'role',
  'status',
  'lastLoginAt',
] as const;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(USER_STATUSES).optional(),
  roleId: id.optional(),
  siteId: id.optional(),
  teamId: id.optional(),
  disciplineId: id.optional(),
  sort: z.enum(USER_SORT_FIELDS).default('name'),
  order: sortOrder,
});
export type ListUsersQuery = z.input<typeof listUsersQuerySchema>;

// ------------------------------------------------------------------ roles

const permissionList = z
  .array(z.string())
  .max(200)
  .refine((codes) => codes.every(isPermissionCode), {
    message: 'Contains an unknown permission.',
  })
  .transform((codes) => [...new Set(codes)]);

export const createRoleSchema = z.object({
  name: requiredText('Role name', 60),
  description: optionalText('Description', 300).default(''),
  orgWideScope: z.boolean().default(false),
  permissions: permissionList,
});
export type CreateRoleInput = z.input<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: requiredText('Role name', 60).optional(),
  description: optionalText('Description', 300),
  orgWideScope: z.boolean().optional(),
  permissions: permissionList.optional(),
});
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

export const duplicateRoleSchema = z.object({
  name: requiredText('Role name', 60),
});
export type DuplicateRoleInput = z.input<typeof duplicateRoleSchema>;

export const listRolesQuerySchema = z.object({
  includeArchived: booleanQuery,
});

// ------------------------------------------------- organisation structure

export const listStructureQuerySchema = z.object({
  includeArchived: booleanQuery,
});

export const createSiteSchema = z.object({
  name: requiredText('Site name', 120),
  code: optionalText('Site code', 30),
  address: optionalText('Address', 500),
});
export type CreateSiteInput = z.input<typeof createSiteSchema>;

export const updateSiteSchema = createSiteSchema.partial();
export type UpdateSiteInput = z.input<typeof updateSiteSchema>;

export const createAreaSchema = z.object({
  name: requiredText('Area name', 120),
});
export type CreateAreaInput = z.input<typeof createAreaSchema>;
export const updateAreaSchema = createAreaSchema;

export const createTeamSchema = z.object({
  name: requiredText('Team name', 120),
  description: optionalText('Description', 300),
});
export type CreateTeamInput = z.input<typeof createTeamSchema>;
export const updateTeamSchema = createTeamSchema.partial();

export const createDisciplineSchema = z.object({
  name: requiredText('Discipline name', 120),
});
export type CreateDisciplineInput = z.input<typeof createDisciplineSchema>;
export const updateDisciplineSchema = createDisciplineSchema;

// ------------------------------------------------------------------ audit

export const listAuditQuerySchema = paginationQuerySchema.extend({
  category: z.string().trim().max(40).optional(),
  search: z.string().trim().max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListAuditQuery = z.input<typeof listAuditQuerySchema>;

// ------------------------------------------- internal staff and provisioning

export const STAFF_PASSWORD_MIN_LENGTH = 12;

const staffPassword = z
  .string()
  .min(
    STAFF_PASSWORD_MIN_LENGTH,
    `Use at least ${STAFF_PASSWORD_MIN_LENGTH} characters.`,
  )
  .max(128, 'Use 128 characters or fewer.');

export const staffLoginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.').max(128),
});
export type StaffLoginInput = z.input<typeof staffLoginSchema>;

export const mfaCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'),
});
export type MfaCodeInput = z.input<typeof mfaCodeSchema>;

export const changeStaffPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: staffPassword,
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from your current one.',
  });
export type ChangeStaffPasswordInput = z.input<
  typeof changeStaffPasswordSchema
>;

export const createStaffSchema = z.object({
  name: requiredText('Name', 100),
  email,
  staffRole: z.enum(STAFF_ROLES),
});
export type CreateStaffInput = z.input<typeof createStaffSchema>;

export const updateStaffSchema = z.object({
  name: requiredText('Name', 100).optional(),
  staffRole: z.enum(STAFF_ROLES).optional(),
});
export type UpdateStaffInput = z.input<typeof updateStaffSchema>;

const organisationFields = {
  name: requiredText('Organisation name', 200),
  industry: requiredText('Industry', 100),
  contactName: requiredText('Primary contact name', 100),
  contactEmail: email,
  contactPhone: z
    .string()
    .trim()
    .min(5, 'Enter a telephone number.')
    .max(40, 'Telephone must be 40 characters or fewer.')
    .regex(/^[0-9+()\-\s.]+$/, 'Use digits, spaces and + ( ) - only.'),
  address: requiredText('Address', 500),
  country: requiredText('Country', 100),
  timeZone: z.string().refine(isValidTimeZone, 'Choose a valid time zone.'),
  seatLimit: z
    .number({ error: 'Enter a seat limit.' })
    .int('Seat limit must be a whole number.')
    .min(1, 'Seat limit must be at least 1.')
    .max(100000),
  startsOn: isoDate,
  expiresOn: isoDate,
};

const datesInOrder = (data: { startsOn?: string; expiresOn?: string }) =>
  !data.startsOn || !data.expiresOn || data.expiresOn >= data.startsOn;

const datesMessage = {
  path: ['expiresOn'],
  message: 'Expiry date must be on or after the start date.',
};

export const createOrganisationSchema = z
  .object({
    ...organisationFields,
    firstAdmin: z.object({
      firstName: requiredText('First name', 60),
      lastName: requiredText('Last name', 60),
      email: optionalEmail,
    }),
  })
  .refine(datesInOrder, datesMessage);
export type CreateOrganisationInput = z.input<typeof createOrganisationSchema>;

export const updateOrganisationSchema = z
  .object(organisationFields)
  .partial()
  .refine(datesInOrder, datesMessage);
export type UpdateOrganisationInput = z.input<typeof updateOrganisationSchema>;

/** Optional note recorded with a suspension, activation or archive. */
export const organisationStatusChangeSchema = z.object({
  reason: optionalText('Reason', 500),
});
export type OrganisationStatusChangeInput = z.input<
  typeof organisationStatusChangeSchema
>;

export const resetStaffCredentialsSchema = z.object({
  /** Also remove the authenticator enrolment (lost phone). */
  resetMfa: z.boolean().default(false),
});
export type ResetStaffCredentialsInput = z.input<
  typeof resetStaffCredentialsSchema
>;

export const ORGANISATION_SORT_FIELDS = [
  'name',
  'status',
  'expiresOn',
  'createdAt',
] as const;

export const listOrganisationsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'suspended', 'archived']).optional(),
  sort: z.enum(ORGANISATION_SORT_FIELDS).default('name'),
  order: sortOrder,
});
export type ListOrganisationsQuery = z.input<
  typeof listOrganisationsQuerySchema
>;

// ------------------------------------------------ offline sync (PoC)

export const pocMutationSchema = z.discriminatedUnion('type', [
  z.object({
    id,
    type: z.literal('answer'),
    checkId: id,
    questionKey: z.enum(POC_QUESTION_KEYS),
    value: z.string().max(2000),
    answeredAt: z.iso.datetime({ offset: true }),
  }),
  z.object({
    id,
    type: z.literal('submit'),
    checkId: id,
    submittedAt: z.iso.datetime({ offset: true }),
  }),
]);
export type PocMutation = z.infer<typeof pocMutationSchema>;

export const pocPushSchema = z.object({
  mutations: z.array(pocMutationSchema).max(200),
});
export type PocPushInput = z.input<typeof pocPushSchema>;

export const pocCreateCheckSchema = z.object({
  siteId: id,
  title: requiredText('Check title', 120),
  plantLabel: requiredText('Plant', 120),
});
export type PocCreateCheckInput = z.input<typeof pocCreateCheckSchema>;

export const pocEvidenceFieldsSchema = z.object({
  id,
  questionKey: z.enum(POC_QUESTION_KEYS),
  capturedAt: z.iso.datetime({ offset: true }),
});
