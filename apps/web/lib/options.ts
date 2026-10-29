'use client';

import type { ComboboxItem } from '@mantine/core';
import {
  useDisciplinesQuery,
  useRolesQuery,
  useSitesQuery,
  useTeamsQuery,
} from './api';

interface Named {
  id: string;
  name: string;
  archivedAt: string | null;
}

/**
 * Select options: active items, plus archived ones only when already chosen,
 * so an existing assignment stays visible but nothing archived can be newly
 * picked (ORG-007).
 */
export const toOptions = (
  items: Named[] | undefined,
  selected: readonly string[] = [],
): ComboboxItem[] =>
  (items ?? [])
    .filter((item) => !item.archivedAt || selected.includes(item.id))
    .map((item) => ({
      value: item.id,
      label: item.archivedAt ? `${item.name} (archived)` : item.name,
      disabled: !!item.archivedAt,
    }));

export const useScopeOptions = (
  selected: {
    siteIds?: string[];
    teamIds?: string[];
    disciplineIds?: string[];
  } = {},
) => {
  const sites = useSitesQuery({ includeArchived: true });
  const teams = useTeamsQuery({ includeArchived: true });
  const disciplines = useDisciplinesQuery({ includeArchived: true });
  return {
    sites: toOptions(sites.data, selected.siteIds),
    teams: toOptions(teams.data, selected.teamIds),
    disciplines: toOptions(disciplines.data, selected.disciplineIds),
    loading: sites.isLoading || teams.isLoading || disciplines.isLoading,
  };
};

/** Roles the signed-in user may give out, plus the current one when editing. */
export const useRoleOptions = (currentRoleId?: string): ComboboxItem[] => {
  const { data: roles } = useRolesQuery();
  return (roles ?? [])
    .filter((role) => role.assignable || role.id === currentRoleId)
    .map((role) => ({
      value: role.id,
      label: role.isStandard ? role.name : `${role.name} (custom)`,
      disabled: !role.assignable,
    }));
};
