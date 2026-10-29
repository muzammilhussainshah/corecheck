'use client';

import { type ReactNode, useState } from 'react';
import type { Column } from '@corecheck/ui';
import {
  type ConfigKind,
  useCreateConfigMutation,
  useSetConfigArchivedMutation,
  useUpdateConfigMutation,
} from '../../lib/api';
import { type ConfigTypes, useConfigList } from '../../lib/config';
import {
  type FieldSpec,
  type FieldValues,
  type StructureItem,
  StructureManager,
} from '../structure/StructureManager';

type Row<K extends ConfigKind> = ConfigTypes[K] & StructureItem;

interface Props<K extends ConfigKind> {
  kind: K;
  title: string;
  description: string;
  noun: string;
  fields: FieldSpec[];
  /** The request body for a create or an edit, built from the form. */
  toBody: (values: FieldValues, mode: 'create' | 'update') => object;
  extraColumns?: Column<Row<K>>[];
  rowActions?: (item: Row<K>) => ReactNode;
  /** The name shown and searched; the item's name when omitted. */
  nameOf?: (item: ConfigTypes[K]) => string;
}

/** A plant configuration list (FRD ADM-003) on the Manage page. */
export function ConfigListPage<K extends ConfigKind>(props: Props<K>) {
  const [showArchived, setShowArchived] = useState(false);
  const { data, isFetching, error } = useConfigList(props.kind, {
    includeArchived: showArchived,
  });
  const [create] = useCreateConfigMutation();
  const [update] = useUpdateConfigMutation();
  const [setArchived] = useSetConfigArchivedMutation();
  const nameOf =
    props.nameOf ?? ((item: ConfigTypes[K]) => (item as { name: string }).name);
  // Every list row has an id and archivedAt; the name comes from nameOf.
  const items = data?.map(
    (item) => ({ ...item, name: nameOf(item) }) as Row<K>,
  );

  return (
    <StructureManager<Row<K>>
      title={props.title}
      description={props.description}
      noun={props.noun}
      items={items}
      loading={isFetching}
      error={error}
      showArchived={showArchived}
      onShowArchivedChange={setShowArchived}
      fields={props.fields}
      extraColumns={props.extraColumns}
      rowActions={props.rowActions}
      onCreate={(values) =>
        create({ kind: props.kind, body: props.toBody(values, 'create') })
      }
      onUpdate={(id, values) =>
        update({
          kind: props.kind,
          id,
          body: props.toBody(values, 'update'),
        })
      }
      onArchive={(id, archived) =>
        setArchived({ kind: props.kind, id, archived })
      }
    />
  );
}
