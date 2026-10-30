/** The columns of a plant import file (IPL-002, IPL-003). */
export const PLANT_IMPORT_COLUMNS = [
  { key: 'name', label: 'Equipment Name', required: true },
  { key: 'plantType', label: 'Plant Type', required: true },
  { key: 'ownership', label: 'Ownership Type', required: true },
  { key: 'company', label: 'Owner/Hire Company', required: true },
  { key: 'site', label: 'Site', required: true },
  { key: 'area', label: 'Area', required: false },
  { key: 'disciplines', label: 'Disciplines', required: false },
  { key: 'assetId', label: 'System Asset ID', required: false },
  { key: 'plantNumber', label: 'Plant Number', required: false },
  { key: 'serialNumber', label: 'Serial Number', required: false },
  { key: 'category', label: 'Category', required: false },
  { key: 'make', label: 'Make', required: false },
  { key: 'model', label: 'Model', required: false },
] as const;

export type PlantImportColumn = (typeof PLANT_IMPORT_COLUMNS)[number]['key'];

export const PLANT_IMPORT_MAX_ROWS = 2000;
export const PLANT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export const IMPORT_ROW_STATUSES = [
  'valid',
  'warning',
  'invalid',
  'imported',
  'skipped',
] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export const IMPORT_ROW_STATUS_LABELS: Record<ImportRowStatus, string> = {
  valid: 'Ready',
  warning: 'Possible duplicate',
  invalid: 'Needs correcting',
  imported: 'Imported',
  skipped: 'Using existing plant',
};

/** Plant details an organisation may make mandatory (PLT-008). */
export const PLANT_DETAILS = [
  'plantNumber',
  'serialNumber',
  'make',
  'model',
] as const;
export type PlantDetailKey = (typeof PLANT_DETAILS)[number];

export const PLANT_DETAIL_LABELS: Record<PlantDetailKey, string> = {
  plantNumber: 'Plant Number',
  serialNumber: 'Serial Number',
  make: 'Make',
  model: 'Model',
};
