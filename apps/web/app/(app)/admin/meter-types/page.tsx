'use client';

import { Text } from '@mantine/core';
import { ConfigListPage } from '../../../../components/config/ConfigListPage';
import { textValue } from '../../../../components/structure/StructureManager';

export default function MeterTypesPage() {
  return (
    <ConfigListPage
      kind="meter-types"
      title="Meter types"
      description="Readings taken from plant, such as running hours or mileage. A plant can use several."
      noun="Meter type"
      fields={[
        {
          key: 'name',
          label: 'Name',
          required: true,
          placeholder: 'e.g. Hours',
        },
        {
          key: 'unit',
          label: 'Unit',
          required: true,
          placeholder: 'e.g. hrs',
        },
      ]}
      toBody={(values) => ({
        name: textValue(values.name),
        unit: textValue(values.unit),
      })}
      extraColumns={[
        {
          key: 'unit',
          header: 'Unit',
          render: (meter) => <Text size="sm">{meter.unit}</Text>,
        },
      ]}
    />
  );
}
