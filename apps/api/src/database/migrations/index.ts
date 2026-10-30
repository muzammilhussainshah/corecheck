import { InitialSchema1760500000000 } from './1760500000000-initial-schema.js';
import { OrganisationStorageUsage1760600000000 } from './1760600000000-organisation-storage-usage.js';
import { PlantConfiguration1760700000000 } from './1760700000000-plant-configuration.js';
import { PlantRegister1760800000000 } from './1760800000000-plant-register.js';
import { PlantDocuments1760900000000 } from './1760900000000-plant-documents.js';
import { Reception1761000000000 } from './1761000000000-reception.js';
import { MeterReadings1761100000000 } from './1761100000000-meter-readings.js';
import { PlantImports1761200000000 } from './1761200000000-plant-imports.js';
import { OrganisationPlantUsage1761300000000 } from './1761300000000-organisation-plant-usage.js';
import { PlantSettingsAndImportRows1761400000000 } from './1761400000000-plant-settings-and-import-rows.js';

/** Every migration, oldest first. Listed explicitly so the ESM build needs no globbing. */
export const MIGRATIONS = [
  InitialSchema1760500000000,
  OrganisationStorageUsage1760600000000,
  PlantConfiguration1760700000000,
  PlantRegister1760800000000,
  PlantDocuments1760900000000,
  Reception1761000000000,
  MeterReadings1761100000000,
  PlantImports1761200000000,
  OrganisationPlantUsage1761300000000,
  PlantSettingsAndImportRows1761400000000,
];
