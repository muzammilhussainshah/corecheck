'use client';

import { Stack, Text } from '@mantine/core';
import {
  PLANT_COMPANY_KIND_LABELS,
  PLANT_COMPANY_KINDS,
} from '@corecheck/shared';
import { Pill } from '@corecheck/ui';
import { ConfigListPage } from '../../../../components/config/ConfigListPage';
import { textValue } from '../../../../components/structure/StructureManager';

export default function PlantCompaniesPage() {
  return (
    <ConfigListPage
      kind="plant-companies"
      title="Owners and hire companies"
      description="Who plant belongs to: your own companies for owned plant, and the hire companies you rent from."
      noun="Company"
      fields={[
        {
          key: 'kind',
          label: 'Type',
          type: 'select',
          required: true,
          createOnly: true,
          defaultValue: 'hire_company',
          options: PLANT_COMPANY_KINDS.map((kind) => ({
            value: kind,
            label: PLANT_COMPANY_KIND_LABELS[kind],
          })),
        },
        { key: 'name', label: 'Name', required: true },
        { key: 'contactName', label: 'Contact name' },
        { key: 'contactPhone', label: 'Telephone' },
        { key: 'contactEmail', label: 'Email' },
      ]}
      toBody={(values, mode) => ({
        ...(mode === 'create' ? { kind: textValue(values.kind) } : {}),
        name: textValue(values.name),
        contactName: textValue(values.contactName),
        contactPhone: textValue(values.contactPhone),
        contactEmail: textValue(values.contactEmail),
      })}
      extraColumns={[
        {
          key: 'kind',
          header: 'Type',
          render: (company) => (
            <Pill tone={company.kind === 'owner' ? 'info' : 'neutral'}>
              {PLANT_COMPANY_KIND_LABELS[company.kind]}
            </Pill>
          ),
        },
        {
          key: 'contact',
          header: 'Contact',
          render: (company) =>
            company.contactName ||
            company.contactPhone ||
            company.contactEmail ? (
              <Stack gap={0}>
                {company.contactName && (
                  <Text size="sm">{company.contactName}</Text>
                )}
                <Text size="xs" c="dimmed">
                  {[company.contactPhone, company.contactEmail]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Stack>
            ) : (
              <Text size="sm">—</Text>
            ),
        },
      ]}
    />
  );
}
