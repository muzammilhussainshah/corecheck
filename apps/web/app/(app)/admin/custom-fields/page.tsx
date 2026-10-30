'use client';

import { Stack, Text } from '@mantine/core';
import {
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_FIELD_TYPES,
} from '@corecheck/shared';
import { Pill } from '@corecheck/ui';
import { ConfigListPage } from '../../../../components/config/ConfigListPage';
import { RequiredPlantDetails } from '../../../../components/plant/RequiredPlantDetails';
import {
  numberValue,
  textValue,
} from '../../../../components/structure/StructureManager';

export default function CustomFieldsPage() {
  return (
    <Stack gap="lg">
      <ConfigListPage
        kind="custom-fields"
        title="Custom fields"
        description="Extra details recorded on every plant item, such as Fuel type or Colour. The type of a field cannot change once it is created."
        noun="Custom field"
        nameOf={(field) => field.label}
        fields={[
          { key: 'label', label: 'Name', required: true },
          {
            key: 'fieldType',
            label: 'Type',
            type: 'select',
            required: true,
            createOnly: true,
            defaultValue: 'text',
            options: CUSTOM_FIELD_TYPES.map((type) => ({
              value: type,
              label: CUSTOM_FIELD_TYPE_LABELS[type],
            })),
          },
          {
            key: 'options',
            label: 'Choices',
            type: 'tags',
            description: 'Type a choice and press Enter.',
            visible: (values) => values.fieldType === 'select',
          },
          {
            key: 'required',
            label: 'Required',
            type: 'switch',
            description: 'Plant cannot be saved without a value.',
          },
          {
            key: 'sortOrder',
            label: 'Display order',
            type: 'number',
            min: 0,
            max: 1000,
            defaultValue: 0,
            description: 'Lower numbers are shown first.',
          },
        ]}
        toBody={(values, mode) => ({
          label: textValue(values.label),
          ...(mode === 'create'
            ? { fieldType: textValue(values.fieldType) }
            : {}),
          ...(values.fieldType === 'select'
            ? { options: values.options as string[] }
            : {}),
          required: Boolean(values.required),
          sortOrder: numberValue(values.sortOrder) ?? 0,
        })}
        extraColumns={[
          {
            key: 'type',
            header: 'Type',
            render: (field) => (
              <Text size="sm">{CUSTOM_FIELD_TYPE_LABELS[field.fieldType]}</Text>
            ),
          },
          {
            key: 'choices',
            header: 'Choices',
            render: (field) => (
              <Text size="sm" lineClamp={2}>
                {field.options.length ? field.options.join(', ') : '—'}
              </Text>
            ),
          },
          {
            key: 'required',
            header: 'Required',
            render: (field) =>
              field.required ? (
                <Pill tone="info">Required</Pill>
              ) : (
                <Text size="sm">Optional</Text>
              ),
          },
        ]}
      />
      <RequiredPlantDetails />
    </Stack>
  );
}
