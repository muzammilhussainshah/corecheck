'use client';

import { Text } from '@mantine/core';
import { ConfigListPage } from '../../../../components/config/ConfigListPage';
import {
  numberValue,
  textValue,
} from '../../../../components/structure/StructureManager';
import { useConfigList } from '../../../../lib/config';

export default function DocumentTypesPage() {
  const { data: plantTypes } = useConfigList('plant-types');
  const mandatoryFor = (documentTypeId: string) =>
    (plantTypes ?? [])
      .filter((type) => type.requiredDocumentTypeIds.includes(documentTypeId))
      .map((type) => type.name);

  return (
    <ConfigListPage
      kind="document-types"
      title="Document types"
      description="Certificates and records kept for plant, such as LOLER or Insurance. Choose which plant types need them under Plant types."
      noun="Document type"
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'description', label: 'Description' },
        {
          key: 'hasExpiry',
          label: 'Has an expiry date',
          type: 'switch',
          defaultValue: true,
        },
        {
          key: 'warningDays',
          label: 'Warn before expiry (days)',
          type: 'number',
          required: true,
          min: 0,
          max: 365,
          defaultValue: 30,
          description:
            'The document shows Approaching Expiry this many days before it expires.',
          visible: (values) => values.hasExpiry === true,
        },
      ]}
      toBody={(values) => ({
        name: textValue(values.name),
        description: textValue(values.description),
        hasExpiry: Boolean(values.hasExpiry),
        ...(values.hasExpiry
          ? { warningDays: numberValue(values.warningDays) }
          : {}),
      })}
      extraColumns={[
        {
          key: 'expiry',
          header: 'Expiry',
          render: (doc) => (
            <Text size="sm">
              {doc.hasExpiry
                ? `Warn ${doc.warningDays} days before`
                : 'Does not expire'}
            </Text>
          ),
        },
        {
          key: 'mandatory',
          header: 'Mandatory for',
          render: (doc) => {
            const types = mandatoryFor(doc.id);
            return (
              <Text size="sm">{types.length ? types.join(', ') : '—'}</Text>
            );
          },
        },
      ]}
    />
  );
}
