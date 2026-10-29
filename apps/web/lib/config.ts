import type {
  CustomField,
  DocumentType,
  MeterType,
  PlantCategory,
  PlantCompany,
  PlantType,
} from '@corecheck/shared';
import { type ConfigKind, useConfigListQuery } from './api';

/** The row type each /config list returns. */
export interface ConfigTypes {
  'plant-types': PlantType;
  'plant-categories': PlantCategory;
  'plant-companies': PlantCompany;
  'custom-fields': CustomField;
  'meter-types': MeterType;
  'document-types': DocumentType;
}

/** One configuration list, typed for its kind. */
export const useConfigList = <K extends ConfigKind>(
  kind: K,
  options: { includeArchived?: boolean; skip?: boolean } = {},
) => {
  const result = useConfigListQuery(
    { kind, includeArchived: options.includeArchived },
    { skip: options.skip },
  );
  return {
    ...result,
    data: result.data as ConfigTypes[K][] | undefined,
  };
};
