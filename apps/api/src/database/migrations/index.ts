import { InitialSchema1760500000000 } from './1760500000000-initial-schema.js';
import { OrganisationStorageUsage1760600000000 } from './1760600000000-organisation-storage-usage.js';

/** Every migration, oldest first. Listed explicitly so the ESM build needs no globbing. */
export const MIGRATIONS = [
  InitialSchema1760500000000,
  OrganisationStorageUsage1760600000000,
];
