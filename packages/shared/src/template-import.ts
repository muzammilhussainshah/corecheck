/**
 * Check template import (FRD 19.4): one row per question; rows with the same
 * Template Name make one template. Template-wide columns (purpose, approval,
 * plant types, disciplines) are read from a template's first row.
 */
export const TEMPLATE_IMPORT_COLUMNS = [
  { key: 'template', label: 'Template Name', required: true },
  { key: 'purpose', label: 'Purpose', required: true },
  { key: 'approval', label: 'Approval', required: false },
  { key: 'plantTypes', label: 'Applicable Plant Types', required: false },
  { key: 'disciplines', label: 'Eligible Disciplines', required: false },
  { key: 'question', label: 'Question', required: true },
  { key: 'type', label: 'Answer Type', required: true },
  { key: 'mandatory', label: 'Mandatory', required: false },
  { key: 'failAnswer', label: 'Fail Answer', required: false },
  { key: 'choices', label: 'Choices', required: false },
  { key: 'failChoices', label: 'Failing Choices', required: false },
  { key: 'min', label: 'Lowest Allowed', required: false },
  { key: 'max', label: 'Highest Allowed', required: false },
  { key: 'meter', label: 'Meter Type', required: false },
  { key: 'comment', label: 'Comment', required: false },
  { key: 'photo', label: 'Photo', required: false },
  { key: 'offline', label: 'Fail Takes Plant Offline', required: false },
  { key: 'severity', label: 'Defect Severity', required: false },
  { key: 'followUpOf', label: 'Follow-up Of Question', required: false },
  { key: 'askedWhen', label: 'Asked When', required: false },
] as const;

export type TemplateImportColumn =
  (typeof TEMPLATE_IMPORT_COLUMNS)[number]['key'];

/** Columns that apply to the whole template, taken from its first row. */
export const TEMPLATE_LEVEL_COLUMNS: readonly TemplateImportColumn[] = [
  'purpose',
  'approval',
  'plantTypes',
  'disciplines',
];

export const TEMPLATE_IMPORT_MAX_ROWS = 1000;

export const TEMPLATE_IMPORT_ROW_STATUSES = [
  'valid',
  'invalid',
  'imported',
] as const;
export type TemplateImportRowStatus =
  (typeof TEMPLATE_IMPORT_ROW_STATUSES)[number];

export const TEMPLATE_IMPORT_ROW_STATUS_LABELS: Record<
  TemplateImportRowStatus,
  string
> = {
  valid: 'Ready',
  invalid: 'Needs correcting',
  imported: 'Imported as Draft',
};
