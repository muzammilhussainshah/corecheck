'use client';

import { Text } from '@mantine/core';
import { useState } from 'react';
import type { Team } from '@corecheck/shared';
import {
  StructureManager,
  textValue,
} from '../../../../components/structure/StructureManager';
import {
  useCreateStructureMutation,
  useSetStructureArchivedMutation,
  useTeamsQuery,
  useUpdateStructureMutation,
} from '../../../../lib/api';

export default function TeamsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { data, isFetching, error } = useTeamsQuery({
    includeArchived: showArchived,
  });
  const [create] = useCreateStructureMutation();
  const [update] = useUpdateStructureMutation();
  const [setArchived] = useSetStructureArchivedMutation();

  return (
    <StructureManager<Team>
      title="Teams"
      description="Groups of people. Supervisors see and manage the work of their teams."
      noun="Team"
      items={data}
      loading={isFetching}
      error={error}
      showArchived={showArchived}
      onShowArchivedChange={setShowArchived}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'description', label: 'Description' },
      ]}
      extraColumns={[
        {
          key: 'description',
          header: 'Description',
          render: (team) => <Text size="sm">{team.description ?? '—'}</Text>,
        },
        {
          key: 'members',
          header: 'Members',
          align: 'right',
          render: (team) => <Text size="sm">{team.memberCount}</Text>,
        },
      ]}
      onCreate={(values) =>
        create({
          kind: 'teams',
          body: {
            name: textValue(values.name),
            description: textValue(values.description),
          },
        })
      }
      onUpdate={(id, values) =>
        update({
          kind: 'teams',
          id,
          body: {
            name: textValue(values.name),
            description: textValue(values.description),
          },
        })
      }
      onArchive={(id, archived) => setArchived({ kind: 'teams', id, archived })}
    />
  );
}
