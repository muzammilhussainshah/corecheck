'use client';

import { Text } from '@mantine/core';
import { ConfigListPage } from '../../../../components/config/ConfigListPage';
import { textValue } from '../../../../components/structure/StructureManager';

export default function PlantCategoriesPage() {
  return (
    <ConfigListPage
      kind="plant-categories"
      title="Plant categories"
      description="Broader groups used to filter and report on plant, such as Heavy plant or Small tools."
      noun="Category"
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'description', label: 'Description' },
      ]}
      toBody={(values) => ({
        name: textValue(values.name),
        description: textValue(values.description),
      })}
      extraColumns={[
        {
          key: 'description',
          header: 'Description',
          render: (category) => (
            <Text size="sm">{category.description ?? '—'}</Text>
          ),
        },
      ]}
    />
  );
}
