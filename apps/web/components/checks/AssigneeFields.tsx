'use client';

import { SimpleGrid, Select } from '@mantine/core';
import {
  useDisciplinesQuery,
  useTeamsQuery,
  useUsersQuery,
} from '../../lib/api';
import { useSession } from '../../lib/session';

export interface AssigneeValues {
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  assigneeDisciplineId: string | null;
}

/**
 * Who the work goes to: a user, a team and/or a discipline (Appendix B,
 * SCH-004). At least one is needed; the API says so under the user field.
 */
export function AssigneeFields({
  value,
  onChange,
  error,
}: {
  value: AssigneeValues;
  onChange: (value: AssigneeValues) => void;
  error?: string;
}) {
  const { can } = useSession();
  const { data: users } = useUsersQuery(
    { page: 1, pageSize: 100, status: 'active' },
    { skip: !can('users.view') },
  );
  const { data: teams } = useTeamsQuery();
  const { data: disciplines } = useDisciplinesQuery();
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }}>
      <Select
        label="User"
        placeholder="Anyone in the team or discipline"
        searchable
        clearable
        data={(users?.items ?? []).map((user) => ({
          value: user.id,
          label: `${user.firstName} ${user.lastName}`,
        }))}
        value={value.assigneeUserId}
        onChange={(assigneeUserId) => onChange({ ...value, assigneeUserId })}
        error={error}
      />
      <Select
        label="Team"
        placeholder="No team"
        searchable
        clearable
        data={(teams ?? []).filter((t) => !t.archivedAt).map((team) => ({
          value: team.id,
          label: team.name,
        }))}
        value={value.assigneeTeamId}
        onChange={(assigneeTeamId) => onChange({ ...value, assigneeTeamId })}
      />
      <Select
        label="Discipline"
        placeholder="No discipline"
        searchable
        clearable
        data={(disciplines ?? [])
          .filter((d) => !d.archivedAt)
          .map((discipline) => ({ value: discipline.id, label: discipline.name }))}
        value={value.assigneeDisciplineId}
        onChange={(assigneeDisciplineId) =>
          onChange({ ...value, assigneeDisciplineId })
        }
      />
    </SimpleGrid>
  );
}
