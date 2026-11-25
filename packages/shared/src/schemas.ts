import { PLANT_DETAILS } from './plant-import.js';
import { z } from 'zod';
import { isPermissionCode } from './permissions.js';
import { newPinProblem, PIN_PATTERN } from './pin.js';
import { POC_QUESTION_KEYS } from './poc.js';
import { questionCanFail, type TemplateQuestion } from './reception.js';
import {
  APPROVAL_MODES,
  CHECK_STATUSES,
  CHECK_VIEWS,
  DEFECT_STATUSES,
  SCHEDULE_BASES,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_UNITS,
  SEPARATION_RULES,
  CLIENT_TYPES,
  CUSTOM_FIELD_TYPES,
  DEFECT_SEVERITIES,
  DOCUMENT_STATES,
  EVIDENCE_RULES,
  QUESTION_TYPES,
  TEMPLATE_PURPOSES,
  PLANT_COMPANY_KINDS,
  PLANT_COMPLIANCE_STATES,
  PLANT_OWNERSHIPS,
  PLANT_STATUSES,
  RESTRICTION_REASONS,
  STAFF_ROLES,
  USER_STATUSES,
} from './statuses.js';

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

// ---------------------------------------------------- plant configuration

export const createPlantTypeSchema = z.object({
  name: requiredText('Plant type name', 120),
  description: optionalText('Description', 300),
});
export type CreatePlantTypeInput = z.input<typeof createPlantTypeSchema>;
export const updatePlantTypeSchema = createPlantTypeSchema.partial();
export type UpdatePlantTypeInput = z.input<typeof updatePlantTypeSchema>;

export const createPlantCategorySchema = z.object({
  name: requiredText('Category name', 120),
  description: optionalText('Description', 300),
});
export type CreatePlantCategoryInput = z.input<
  typeof createPlantCategorySchema
>;
export const updatePlantCategorySchema = createPlantCategorySchema.partial();
export type UpdatePlantCategoryInput = z.input<
  typeof updatePlantCategorySchema
>;

const plantCompanyFields = {
  name: requiredText('Company name', 160),
  contactName: optionalText('Contact name', 100),
  contactPhone: optionalText('Telephone', 40),
  contactEmail: z.union([z.literal(''), email]).optional(),
};

export const createPlantCompanySchema = z.object({
  kind: z.enum(PLANT_COMPANY_KINDS, { error: 'Choose owner or hire company.' }),
  ...plantCompanyFields,
});
export type CreatePlantCompanyInput = z.input<typeof createPlantCompanySchema>;
/** The kind is fixed once created: plant already point at it as owned or hired. */
export const updatePlantCompanySchema = z.object(plantCompanyFields).partial();
export type UpdatePlantCompanyInput = z.input<typeof updatePlantCompanySchema>;

/** The choices of a choice-list custom field: trimmed, unique, non-empty. */
const customFieldOptions = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'A choice cannot be blank.')
      .max(80, 'Choices must be 80 characters or fewer.'),
  )
  .max(50, 'Use 50 choices or fewer.')
  .refine(
    (options) =>
      new Set(options.map((option) => option.toLowerCase())).size ===
      options.length,
    { message: 'Each choice must be different.' },
  );

export const createCustomFieldSchema = z
  .object({
    label: requiredText('Field name', 80),
    fieldType: z.enum(CUSTOM_FIELD_TYPES, { error: 'Choose a field type.' }),
    options: customFieldOptions.default([]),
    required: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .refine((data) => data.fieldType !== 'select' || data.options.length > 0, {
    path: ['options'],
    message: 'Add at least one choice.',
  })
  .transform((data) =>
    data.fieldType === 'select' ? data : { ...data, options: [] },
  );
export type CreateCustomFieldInput = z.input<typeof createCustomFieldSchema>;

/** The field type is fixed once created, so stored values always match it. */
export const updateCustomFieldSchema = z.object({
  label: requiredText('Field name', 80).optional(),
  options: customFieldOptions.optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export type UpdateCustomFieldInput = z.input<typeof updateCustomFieldSchema>;

export const createMeterTypeSchema = z.object({
  name: requiredText('Meter name', 80),
  unit: requiredText('Unit', 20),
});
export type CreateMeterTypeInput = z.input<typeof createMeterTypeSchema>;
export const updateMeterTypeSchema = createMeterTypeSchema.partial();
export type UpdateMeterTypeInput = z.input<typeof updateMeterTypeSchema>;

const warningDays = z
  .number({ error: 'Enter the number of days.' })
  .int('Use a whole number of days.')
  .min(0, 'Use 0 days or more.')
  .max(365, 'Use 365 days or fewer.');

export const createDocumentTypeSchema = z.object({
  name: requiredText('Document type name', 120),
  description: optionalText('Description', 300),
  hasExpiry: z.boolean().default(true),
  warningDays: warningDays.default(30),
});
export type CreateDocumentTypeInput = z.input<typeof createDocumentTypeSchema>;
export const updateDocumentTypeSchema = z.object({
  name: requiredText('Document type name', 120).optional(),
  description: optionalText('Description', 300),
  hasExpiry: z.boolean().optional(),
  warningDays: warningDays.optional(),
});
export type UpdateDocumentTypeInput = z.input<typeof updateDocumentTypeSchema>;

export const setRequiredDocumentsSchema = z.object({
  documentTypeIds: idList,
});
export type SetRequiredDocumentsInput = z.input<
  typeof setRequiredDocumentsSchema
>;

// ------------------------------------------------------------------ plant

/** Letters and digits, with . _ - / and spaces between them. */
export const ASSET_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._\-/ ]*[A-Za-z0-9])?$/;

/** An optional System Asset ID; blank means "generate one" (PLT-002). */
const assetIdField = z
  .string()
  .trim()
  .max(40, 'System Asset ID must be 40 characters or fewer.')
  .refine((value) => value === '' || ASSET_ID_PATTERN.test(value), {
    message: 'Use letters, digits and . _ - / only.',
  })
  .optional()
  .transform((value) => value || undefined);

/** An optional id from a form: blank becomes undefined. */
const optionalId = z
  .union([z.literal(''), id])
  .nullable()
  .optional()
  .transform((value) => value || undefined);

/** An id that may be cleared on edit: blank or null clears it. */
const clearableId = z
  .union([z.literal(''), id])
  .nullable()
  .optional()
  .transform((value) => (value === '' ? null : value));

/** Custom field values keyed by field id; the API checks them per field. */
const customValues = z.record(
  z.uuid('Invalid custom field.'),
  z.union([
    z.string().trim().max(500, 'Use 500 characters or fewer.'),
    z.number().finite(),
  ]),
);

const plantFields = {
  plantNumber: optionalText('Plant Number', 60),
  serialNumber: optionalText('Serial Number', 80),
  name: requiredText('Equipment name', 160),
  plantTypeId: requiredId('Plant type'),
  make: optionalText('Make', 80),
  model: optionalText('Model', 80),
  ownership: z.enum(PLANT_OWNERSHIPS, { error: 'Choose owned or hired.' }),
  companyId: requiredId('Owner or hire company'),
  siteId: requiredId('Site'),
  disciplineIds: idList,
};

/** Registering plant (PLT-006): the required fields plus anything known. */
export const createPlantSchema = z.object({
  ...plantFields,
  assetId: assetIdField,
  categoryId: optionalId,
  areaId: optionalId,
  disciplineIds: idList.default([]),
  customValues: customValues.default({}),
});
export type CreatePlantInput = z.input<typeof createPlantSchema>;

export const updatePlantSchema = z
  .object({
    ...plantFields,
    assetId: z
      .string()
      .trim()
      .min(1, 'System Asset ID is required.')
      .max(40, 'System Asset ID must be 40 characters or fewer.')
      .regex(ASSET_ID_PATTERN, 'Use letters, digits and . _ - / only.'),
    categoryId: clearableId,
    areaId: clearableId,
    customValues,
  })
  .partial();
export type UpdatePlantInput = z.input<typeof updatePlantSchema>;

export const PLANT_SORT_FIELDS = [
  'assetId',
  'name',
  'status',
  'site',
  'type',
  'updatedAt',
] as const;

const plantFilters = {
  search: z.string().trim().max(100).optional(),
  siteId: id.optional(),
  plantTypeId: id.optional(),
  categoryId: id.optional(),
  companyId: id.optional(),
  ownership: z.enum(PLANT_OWNERSHIPS).optional(),
  /** "archived" lists archived plant; otherwise archived plant is left out. */
  status: z.enum([...PLANT_STATUSES, 'archived']).optional(),
  /** Standing against mandatory documents (the register's document filter). */
  compliance: z.enum(PLANT_COMPLIANCE_STATES).optional(),
  sort: z.enum(PLANT_SORT_FIELDS).default('assetId'),
  order: sortOrder,
};

export const listPlantsQuerySchema = paginationQuerySchema.extend(plantFilters);
export type ListPlantsQuery = z.input<typeof listPlantsQuerySchema>;

export const exportPlantsQuerySchema = z.object({
  ...plantFilters,
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
});
export type ExportPlantsQuery = z.input<typeof exportPlantsQuerySchema>;

/** Labels for chosen plant (ids, comma separated) or for a filtered list. */
export const plantQrLabelsQuerySchema = z.object({
  ...plantFilters,
  ids: z
    .string()
    .optional()
    .transform((value) =>
      value ? [...new Set(value.split(',').filter(Boolean))] : undefined,
    )
    .pipe(z.array(id).max(500).optional()),
});
export type PlantQrLabelsQuery = z.input<typeof plantQrLabelsQuerySchema>;

export const plantDuplicatesQuerySchema = z.object({
  plantNumber: z.string().trim().max(60).optional(),
  serialNumber: z.string().trim().max(80).optional(),
  /** The plant being edited, which is not its own duplicate. */
  excludeId: id.optional(),
});
export type PlantDuplicatesQuery = z.input<typeof plantDuplicatesQuerySchema>;

/** Taking plant out of use (PLC-005); the note is kept in its history. */
export const restrictPlantSchema = z.object({
  reason: z.enum(RESTRICTION_REASONS).nullable().optional(),
  note: requiredText('Reason', 500),
});
export type RestrictPlantInput = z.input<typeof restrictPlantSchema>;

/**
 * Returning restricted plant to service. An override puts plant back in use
 * despite missing or expired mandatory documents; it needs a reason and a
 * review date, after which the restriction applies again (PLC-007, DOC-008).
 */
export const returnToServiceSchema = z
  .object({
    note: optionalText('Note', 500),
    override: z.boolean().default(false),
    reviewOn: z.union([z.literal(''), isoDate]).optional(),
    /**
     * Returns plant to service although a Defect that took it Offline is
     * still open (DFW-009); needs the Defect override permission and a reason.
     */
    overrideDefects: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.overrideDefects && !data.note)
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Give the reason for the override.',
      });
    if (!data.override) return;
    if (!data.note)
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Give the reason for the override.',
      });
    if (!data.reviewOn)
      ctx.addIssue({
        code: 'custom',
        path: ['reviewOn'],
        message: 'Choose the date the override must be reviewed by.',
      });
  });
export type ReturnToServiceInput = z.input<typeof returnToServiceSchema>;

// -------------------------------------------------------------- documents

const optionalDate = z
  .union([z.literal(''), isoDate])
  .optional()
  .transform((value) => value || undefined);

/** Fields sent with an uploaded document file (DOC-002). */
const documentFields = {
  reference: optionalText('Reference', 100),
  issuedOn: optionalDate,
  expiresOn: optionalDate,
};

const issuedBeforeExpiry = {
  check: (data: { issuedOn?: string; expiresOn?: string }) =>
    !data.issuedOn || !data.expiresOn || data.expiresOn >= data.issuedOn,
  message: {
    path: ['expiresOn'],
    message: 'The expiry date must be on or after the issue date.',
  },
};

export const uploadDocumentSchema = z
  .object({ documentTypeId: requiredId('Document type'), ...documentFields })
  .refine(issuedBeforeExpiry.check, issuedBeforeExpiry.message);
export type UploadDocumentInput = z.input<typeof uploadDocumentSchema>;

export const replaceDocumentSchema = z
  .object(documentFields)
  .refine(issuedBeforeExpiry.check, issuedBeforeExpiry.message);
export type ReplaceDocumentInput = z.input<typeof replaceDocumentSchema>;

export const rejectDocumentSchema = z.object({
  reason: requiredText('Reason', 500),
});
export type RejectDocumentInput = z.input<typeof rejectDocumentSchema>;

export const listDocumentsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  state: z.enum(DOCUMENT_STATES).exclude(['missing']).optional(),
  documentTypeId: id.optional(),
  siteId: id.optional(),
  sort: z.enum(['expiresOn', 'uploadedAt', 'assetId']).default('expiresOn'),
  order: sortOrder,
});
export type ListDocumentsQuery = z.input<typeof listDocumentsQuerySchema>;

// ------------------------------------------------- templates and reception

const nullableNumber = z.number().finite().nullable().default(null);

/** One question; rules that only make sense for some types are checked. */
export const templateQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    text: requiredText('Question', 300),
    type: z.enum(QUESTION_TYPES, { error: 'Choose a question type.' }),
    mandatory: z.boolean().default(true),
    failAnswer: z.enum(['yes', 'no']).nullable().default(null),
    min: nullableNumber,
    max: nullableNumber,
    meterTypeId: z.uuid().nullable().default(null),
    requireComment: z.enum(EVIDENCE_RULES).default('never'),
    requirePhoto: z.enum(EVIDENCE_RULES).default('never'),
    options: z
      .array(
        z
          .string()
          .trim()
          .min(1, 'A choice cannot be blank.')
          .max(100, 'Keep each choice to 100 characters or fewer.'),
      )
      .max(30, 'Use 30 choices or fewer.')
      .default([]),
    failOptions: z.array(z.string().trim().max(100)).max(30).default([]),
    offlineOnFail: z.boolean().default(false),
    defectSeverity: z.enum(DEFECT_SEVERITIES).nullable().default(null),
    showIf: z
      .object({
        questionId: z.string().trim().min(1).max(40),
        when: z.enum(['fail', 'pass', 'values']),
        values: z.array(z.string().trim().max(100)).max(30).default([]),
      })
      .nullable()
      .default(null),
  })
  .superRefine((question, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (question.type === 'meter' && !question.meterTypeId)
      issue('meterTypeId', 'Choose the meter this question reads.');
    if (question.type === 'single_select') {
      if (question.options.length < 2)
        issue('options', 'Give at least two choices.');
      const lower = question.options.map((option) => option.toLowerCase());
      if (new Set(lower).size !== lower.length)
        issue('options', 'Each choice must be different.');
      if (question.failOptions.some((item) => !question.options.includes(item)))
        issue('failOptions', 'A failing choice must be one of the choices.');
    }
    if (question.showIf?.when === 'values' && !question.showIf.values.length)
      issue('showIf', 'Choose the answers that ask this question.');
    if (
      question.min !== null &&
      question.max !== null &&
      question.min > question.max
    )
      issue('max', 'The highest value must not be below the lowest.');
    const canFail = questionCanFail(question as TemplateQuestion);
    if (!canFail) {
      if (question.offlineOnFail)
        issue(
          'offlineOnFail',
          'This question cannot fail, so it cannot take plant Offline.',
        );
      if (question.defectSeverity)
        issue(
          'defectSeverity',
          'This question cannot fail, so it cannot raise a Defect.',
        );
      for (const key of ['requireComment', 'requirePhoto'] as const)
        if (question[key] === 'on_fail')
          issue(key, 'This question cannot fail; choose optional or always.');
    }
  })
  .transform((question) => ({
    ...question,
    // Settings of other types are dropped so a version holds only what applies.
    failAnswer: question.type === 'yes_no' ? question.failAnswer : null,
    min: question.type === 'number' ? question.min : null,
    max: question.type === 'number' ? question.max : null,
    meterTypeId: question.type === 'meter' ? question.meterTypeId : null,
    options: question.type === 'single_select' ? question.options : [],
    failOptions:
      question.type === 'single_select' ? question.failOptions : [],
  }));

/** Who and what a template applies to; empty lists place no limit (TMP-008). */
export const templateEligibilitySchema = z.object({
  plantTypeIds: idList.default([]),
  categoryIds: idList.default([]),
  disciplineIds: idList.default([]),
  teamIds: idList.default([]),
  userIds: idList.default([]),
});
export type TemplateEligibility = z.output<typeof templateEligibilitySchema>;

const recurrenceSchema = z
  .object({
    frequency: z.enum(SCHEDULE_FREQUENCIES),
    customUnit: z.enum(SCHEDULE_UNITS).nullable().default(null),
    customCount: z.number().int().min(1).max(366).nullable().default(null),
  })
  .refine(
    (data) =>
      data.frequency !== 'custom' || (!!data.customUnit && !!data.customCount),
    { path: ['customCount'], message: 'Give the custom interval.' },
  );
export type TemplateRecurrence = z.output<typeof recurrenceSchema>;

export const createTemplateSchema = z.object({
  name: requiredText('Template name', 120),
  description: optionalText('Description', 500),
  purpose: z.enum(TEMPLATE_PURPOSES).default('reception'),
  approvalMode: z.enum(APPROVAL_MODES).default('manual'),
});
export type CreateTemplateInput = z.input<typeof createTemplateSchema>;

/** Every follow-up must follow an earlier question (no loops). */
const questionList = z
  .array(templateQuestionSchema)
  .max(100, 'Use 100 questions or fewer.')
  .superRefine((questions, ctx) => {
    const ids = questions.map((question) => question.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Each question needs its own id.' });
    questions.forEach((question, index) => {
      const condition = question.showIf;
      if (!condition) return;
      const parentIndex = ids.indexOf(condition.questionId);
      const parent = questions[parentIndex];
      const path = [index, 'showIf'];
      if (!parent || parentIndex >= index) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: 'A follow-up must follow an earlier question.',
        });
        return;
      }
      if (
        condition.when !== 'values' &&
        !questionCanFail(parent as TemplateQuestion)
      )
        ctx.addIssue({
          code: 'custom',
          path,
          message: 'That question cannot fail; choose the answers instead.',
        });
      if (condition.when === 'values') {
        const allowed =
          parent.type === 'single_select'
            ? parent.options
            : parent.type === 'yes_no'
              ? ['yes', 'no']
              : parent.type === 'pass_fail'
                ? ['pass', 'fail']
                : null;
        if (!allowed)
          ctx.addIssue({
            code: 'custom',
            path,
            message:
              'Follow a yes/no, pass/fail or single-selection question to choose answers.',
          });
        else if (condition.values.some((value) => !allowed.includes(value)))
          ctx.addIssue({
            code: 'custom',
            path,
            message: 'Choose answers the earlier question offers.',
          });
      }
    });
  });

/** Saves the draft version; a published template gets a new draft. */
export const saveTemplateDraftSchema = z.object({
  name: requiredText('Template name', 120).optional(),
  description: optionalText('Description', 500),
  approvalMode: z.enum(APPROVAL_MODES).optional(),
  questions: questionList.optional(),
  eligibility: templateEligibilitySchema.optional(),
  separation: z.enum(SEPARATION_RULES).optional(),
  requireCorrectiveAction: z.boolean().optional(),
  requireRepairEvidence: z.boolean().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
});
export type SaveTemplateDraftInput = z.input<typeof saveTemplateDraftSchema>;

export const listTemplatesQuerySchema = z.object({
  purpose: z.enum(TEMPLATE_PURPOSES).optional(),
  includeArchived: booleanQuery,
});

/** A copy of the template as a new Draft (TMP-001). */
export const duplicateTemplateSchema = z.object({
  name: requiredText('Template name', 120),
});
export type DuplicateTemplateInput = z.input<typeof duplicateTemplateSchema>;

/**
 * Publishing a new version: future checks always use it; with
 * applyToUnstarted, checks not yet started move to it too (TMP-005). Started,
 * submitted and completed checks never change (TMP-006).
 */
export const publishTemplateSchema = z.object({
  applyToUnstarted: z.boolean().default(false),
});
export type PublishTemplateInput = z.input<typeof publishTemplateSchema>;

export const assignReceptionSchema = z.object({
  templateId: requiredId('Reception template'),
});
export type AssignReceptionInput = z.input<typeof assignReceptionSchema>;

const answerValue = z.union([
  z.string().trim().max(2000, 'Use 2000 characters or fewer.'),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const saveReceptionAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(40),
        value: answerValue,
        comment: optionalText('Comment', 1000),
      }),
    )
    .max(200),
});
export type SaveReceptionAnswersInput = z.input<
  typeof saveReceptionAnswersSchema
>;

export const returnReceptionSchema = z.object({
  comment: requiredText('Comment', 1000),
});
export type ReturnReceptionInput = z.input<typeof returnReceptionSchema>;

// -------------------------------------------------------------- schedules

/** An assignee id: blank or null means none. */
const assigneeId = z
  .union([z.literal(''), id])
  .nullable()
  .optional()
  .transform((value) => value || null);

/** A check goes to a user, a team and/or a discipline (Appendix B). */
const assigneeFields = {
  assigneeUserId: assigneeId,
  assigneeTeamId: assigneeId,
  assigneeDisciplineId: assigneeId,
};
const hasAssignee = (data: {
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  assigneeDisciplineId: string | null;
}) =>
  !!(data.assigneeUserId || data.assigneeTeamId || data.assigneeDisciplineId);
const assigneeMessage = {
  path: ['assigneeUserId'],
  message: 'Assign it to a user, a team or a discipline.',
};

const scheduleFields = {
  name: requiredText('Schedule name', 120),
  frequency: z.enum(SCHEDULE_FREQUENCIES, { error: 'Choose how often.' }),
  customUnit: z.enum(SCHEDULE_UNITS).nullable().default(null),
  customCount: z
    .number()
    .int('Use a whole number.')
    .min(1, 'Use 1 or more.')
    .max(366, 'Use 366 or fewer.')
    .nullable()
    .default(null),
  basis: z.enum(SCHEDULE_BASES).default('completion'),
  startOn: isoDate,
  requiresApproval: z.boolean().default(false),
  ...assigneeFields,
};

const customGiven = (data: {
  frequency: string;
  customUnit: string | null;
  customCount: number | null;
}) => data.frequency !== 'custom' || (!!data.customUnit && !!data.customCount);
const customMessage = {
  path: ['customCount'],
  message: 'Give the custom interval, e.g. every 6 weeks.',
};

/** One schedule per plant chosen (SCH-001..003). */
export const createScheduleSchema = z
  .object({
    ...scheduleFields,
    templateId: requiredId('Template'),
    plantIds: idList.refine((ids) => ids.length > 0, 'Choose at least one plant.'),
  })
  .refine(customGiven, customMessage)
  .refine(hasAssignee, assigneeMessage);
export type CreateScheduleInput = z.input<typeof createScheduleSchema>;

export const updateScheduleSchema = z
  .object(scheduleFields)
  .refine(customGiven, customMessage)
  .refine(hasAssignee, assigneeMessage);
export type UpdateScheduleInput = z.input<typeof updateScheduleSchema>;

export const pauseScheduleSchema = z.object({
  reason: requiredText('Reason', 500),
});
export type PauseScheduleInput = z.input<typeof pauseScheduleSchema>;

export const listSchedulesQuerySchema = z.object({
  plantId: id.optional(),
  templateId: id.optional(),
  includeArchived: booleanQuery,
});
export type ListSchedulesQuery = z.input<typeof listSchedulesQuerySchema>;

// ----------------------------------------------------------------- checks

/** A check assigned outside any schedule (SCH-004, CHK-001). */
export const createCheckSchema = z
  .object({
    plantId: requiredId('Plant'),
    templateId: requiredId('Template'),
    dueOn: optionalDate,
    requiresReview: z.boolean().optional(),
    ...assigneeFields,
  })
  .refine(hasAssignee, assigneeMessage);
export type CreateCheckInput = z.input<typeof createCheckSchema>;

export const listChecksQuerySchema = paginationQuerySchema.extend({
  view: z.enum(CHECK_VIEWS).default('mine'),
  status: z.enum([...CHECK_STATUSES, 'overdue']).optional(),
  plantId: id.optional(),
  siteId: id.optional(),
  templateId: id.optional(),
  defectId: id.optional(),
  search: z.string().trim().max(100).optional(),
  /** Due date range, for the dashboard's Due Checks area (DSH-002). */
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  /** Submitted from this date on (recent work on the dashboard). */
  submittedFrom: isoDate.optional(),
  /** Submitted with at least one failed answer. */
  failed: booleanQuery,
  /** Raised at least one Defect. */
  withDefects: booleanQuery,
});
export type ListChecksQuery = z.input<typeof listChecksQuerySchema>;

export const assignCheckSchema = z
  .object(assigneeFields)
  .refine(hasAssignee, assigneeMessage);
export type AssignCheckInput = z.input<typeof assignCheckSchema>;

/** Moves one check; the recurring rule is untouched (SCH-AC-04). */
export const rescheduleCheckSchema = z.object({
  dueOn: isoDate,
  reason: optionalText('Reason', 500),
});
export type RescheduleCheckInput = z.input<typeof rescheduleCheckSchema>;

export const saveCheckAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(40),
        value: answerValue,
        comment: optionalText('Comment', 1000),
      }),
    )
    .max(200),
  /** Required to change a submitted check (CHK-010). */
  reason: optionalText('Reason', 500),
});
export type SaveCheckAnswersInput = z.input<typeof saveCheckAnswersSchema>;

export const reviewCheckSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'return']),
    comment: optionalText('Comment', 1000),
    /** Approve a verification despite the separation block (DFW-009). */
    override: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.decision !== 'approve' && !data.comment)
      ctx.addIssue({
        code: 'custom',
        path: ['comment'],
        message:
          data.decision === 'return'
            ? 'Say what needs correcting.'
            : 'Give the reason for rejecting it.',
      });
    if (data.override && !data.comment)
      ctx.addIssue({
        code: 'custom',
        path: ['comment'],
        message: 'Give the reason for the override.',
      });
  });
export type ReviewCheckInput = z.input<typeof reviewCheckSchema>;

export const reasonSchema = z.object({
  reason: requiredText('Reason', 500),
});
export type ReasonInput = z.input<typeof reasonSchema>;

// ---------------------------------------------------------------- defects

export const listDefectsQuerySchema = paginationQuerySchema.extend({
  status: z.enum([...DEFECT_STATUSES, 'active']).optional(),
  severity: z.enum(DEFECT_SEVERITIES).optional(),
  plantId: id.optional(),
  siteId: id.optional(),
  assignedToMe: booleanQuery,
  search: z.string().trim().max(100).optional(),
});
export type ListDefectsQuery = z.input<typeof listDefectsQuerySchema>;

/** Classify and assign (Appendix C): severity and/or the assignee. */
export const assignDefectSchema = z.object({
  /** Left out: unchanged; null or blank: unassigned. */
  assigneeUserId: clearableId,
  severity: z.enum(DEFECT_SEVERITIES).optional(),
});
export type AssignDefectInput = z.input<typeof assignDefectSchema>;

export const recordDefectWorkSchema = z.object({
  correctiveAction: optionalText('Corrective action', 2000),
  repairNotes: optionalText('Repair notes', 2000),
});
export type RecordDefectWorkInput = z.input<typeof recordDefectWorkSchema>;

export const startVerificationSchema = z.object({
  templateId: requiredId('Verification template'),
});
export type StartVerificationInput = z.input<typeof startVerificationSchema>;

export const closeDefectSchema = z.object({
  note: optionalText('Note', 1000),
});
export type CloseDefectInput = z.input<typeof closeDefectSchema>;

// --------------------------------------------------------- meter readings

const meterValue = z
  .number({ error: 'Enter the reading as a number.' })
  .finite()
  .min(0, 'A reading cannot be negative.')
  .max(999_999_999, 'That reading is too large.');

export const createMeterReadingSchema = z.object({
  meterTypeId: requiredId('Meter'),
  value: meterValue,
  readAt: z.iso.datetime({ offset: true }).optional(),
  /** Required when the value is below the meter's latest reading. */
  resetReason: optionalText('Reason', 500),
});
export type CreateMeterReadingInput = z.input<typeof createMeterReadingSchema>;

export const correctMeterReadingSchema = z.object({
  value: meterValue,
  reason: requiredText('Reason', 500),
});
export type CorrectMeterReadingInput = z.input<
  typeof correctMeterReadingSchema
>;

// -------------------------------------------------------- plant settings

export const plantSettingsSchema = z.object({
  requiredFields: z.array(z.enum(PLANT_DETAILS)).max(PLANT_DETAILS.length),
});
export type PlantSettings = z.output<typeof plantSettingsSchema>;

// ---------------------------------------------------------- plant import

/** A correction to a row, and/or confirmation of a possible duplicate. */
export const updateImportRowSchema = z.object({
  data: z.record(z.string().max(100), z.string().max(500)).optional(),
  confirmed: z.boolean().optional(),
  /** Use the existing plant: the row is left out of the import. */
  skipped: z.boolean().optional(),
});
export type UpdateImportRowInput = z.input<typeof updateImportRowSchema>;

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
