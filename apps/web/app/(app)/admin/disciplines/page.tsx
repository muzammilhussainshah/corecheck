'use client';

import { Text } from '@mantine/core';
import { useState } from 'react';
import type { Discipline } from '@corecheck/shared';
import { StructureManager } from '../../../../components/structure/StructureManager';
import {
  useCreateStructureMutation,
  useDisciplinesQuery,
  useSetStructureArchivedMutation,
  useUpdateStructureMutation,
} from '../../../../lib/api';

export default function DisciplinesPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { data, isFetching, error } = useDisciplinesQuery({
    includeArchived: showArchived,
  });
  const [create] = useCreateStructureMutation();
  const [update] = useUpdateStructureMutation();
  const [setArchived] = useSetStructureArchivedMutation();

  return (
    <StructureManager<Discipline>
      title="Disciplines"
      description="Technical specialisms such as Mechanical or Electrical. Add your own without a new role (ORG-005)."
      noun="Discipline"
      items={data}
      loading={isFetching}
      error={error}
      showArchived={showArchived}
      onShowArchivedChange={setShowArchived}
      fields={[{ key: 'name', label: 'Name', required: true }]}
      extraColumns={[
        {
          key: 'members',
          header: 'People',
          align: 'right',
          render: (item) => <Text size="sm">{item.memberCount}</Text>,
        },
      ]}
      onCreate={(values) =>
        create({ kind: 'disciplines', body: { name: values.name! } })
      }
      onUpdate={(id, values) =>
        update({ kind: 'disciplines', id, body: { name: values.name! } })
      }
      onArchive={(id, archived) =>
        setArchived({ kind: 'disciplines', id, archived })
      }
    />
  );
}
