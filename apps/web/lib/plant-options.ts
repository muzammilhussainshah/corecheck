'use client';

import type { PlantOwnership } from '@corecheck/shared';
import { OWNERSHIP_COMPANY_KIND } from '@corecheck/shared';
import { useAreasQuery, useDisciplinesQuery, useSitesQuery } from './api';
import { useConfigList } from './config';
import { toOptions } from './options';

/**
 * Choices for the plant form: active configuration, plus the archived items
 * this plant already uses so they stay visible (but cannot be newly picked).
 */
export const usePlantOptions = (
  current: {
    plantTypeId?: string;
    categoryId?: string | null;
    companyId?: string;
    siteId?: string;
    areaId?: string | null;
    disciplineIds?: string[];
  },
  ownership: PlantOwnership | '',
  siteId: string,
) => {
  const types = useConfigList('plant-types', { includeArchived: true });
  const categories = useConfigList('plant-categories', {
    includeArchived: true,
  });
  const companies = useConfigList('plant-companies', {
    includeArchived: true,
  });
  const fields = useConfigList('custom-fields', { includeArchived: true });
  const sites = useSitesQuery({ includeArchived: true });
  const disciplines = useDisciplinesQuery({ includeArchived: true });
  const areas = useAreasQuery(
    { siteId, includeArchived: true },
    { skip: !siteId },
  );
  const one = (id: string | null | undefined) => (id ? [id] : []);
  const kind = ownership ? OWNERSHIP_COMPANY_KIND[ownership] : null;

  return {
    types: toOptions(types.data, one(current.plantTypeId)),
    categories: toOptions(categories.data, one(current.categoryId)),
    companies: toOptions(
      companies.data?.filter((company) => company.kind === kind),
      one(current.companyId),
    ),
    sites: toOptions(sites.data, one(current.siteId)),
    areas: toOptions(areas.data, one(current.areaId)),
    disciplines: toOptions(disciplines.data, current.disciplineIds),
    /** Active custom fields in display order (PLT-008). */
    customFields: (fields.data ?? []).filter((field) => !field.archivedAt),
    allCustomFields: fields.data ?? [],
    loading:
      types.isLoading ||
      companies.isLoading ||
      sites.isLoading ||
      fields.isLoading,
  };
};
