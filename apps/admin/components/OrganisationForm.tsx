'use client';

import {
  Button,
  Fieldset,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import type { UseFormReturnType } from '@mantine/form';
import { IconCalendar } from '@tabler/icons-react';
import type { FormEvent } from 'react';

export interface OrganisationValues {
  name: string;
  industry: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  country: string;
  timeZone: string;
  seatLimit: number | string;
  startsOn: string;
  expiresOn: string;
  firstAdmin?: { firstName: string; lastName: string; email: string };
}

/** Every IANA zone the browser knows; fixed for the page's lifetime. */
const TIME_ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'Europe/London'];
  }
})();

/** Card heading, placed inside the Fieldset rather than on its border. */
const SectionTitle = ({ children }: { children: string }) => (
  <Text ff="var(--mantine-font-family-headings)" fw={600} c="dark" mb="sm">
    {children}
  </Text>
);

/** English country names from the browser's region data, sorted A–Z. */
const COUNTRIES: string[] = (() => {
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    // Region codes that are not countries.
    const skip = new Set(['EU', 'EZ', 'QO', 'UN', 'XA', 'XB', 'ZZ']);
    const found = new Set<string>();
    for (const a of letters) {
      for (const b of letters) {
        const code = a + b;
        const name = names.of(code);
        // Unassigned codes echo back unchanged.
        if (name && name !== code && !skip.has(code)) found.add(name);
      }
    }
    return [...found].sort((x, y) => x.localeCompare(y));
  } catch {
    return ['United Kingdom'];
  }
})();

/** The organisation fields of IAD-002, shared by create and edit. */
export function OrganisationForm({
  form,
  onSubmit,
  submitLabel,
  loading,
  withFirstAdmin,
}: {
  form: UseFormReturnType<OrganisationValues>;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  loading: boolean;
  withFirstAdmin?: boolean;
}) {
  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack>
        <Fieldset>
          <SectionTitle>Organisation</SectionTitle>
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="Organisation name"
                required
                {...form.getInputProps('name')}
              />
              <TextInput
                label="Industry"
                required
                {...form.getInputProps('industry')}
              />
            </SimpleGrid>
            <Textarea
              label="Address"
              required
              autosize
              minRows={2}
              {...form.getInputProps('address')}
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select
                label="Country"
                data={COUNTRIES}
                searchable
                required
                {...form.getInputProps('country')}
              />
              <Select
                label="Time zone"
                description="Due dates, expiry and audit times use this zone."
                data={TIME_ZONES}
                searchable
                required
                {...form.getInputProps('timeZone')}
              />
            </SimpleGrid>
          </Stack>
        </Fieldset>
        <Fieldset>
          <SectionTitle>Primary contact</SectionTitle>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <TextInput
              label="Name"
              required
              {...form.getInputProps('contactName')}
            />
            <TextInput
              label="Email"
              type="email"
              required
              {...form.getInputProps('contactEmail')}
            />
            <TextInput
              label="Telephone"
              required
              {...form.getInputProps('contactPhone')}
            />
          </SimpleGrid>
        </Fieldset>
        <Fieldset>
          <SectionTitle>Account</SectionTitle>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <NumberInput
              label="User seat limit"
              min={1}
              required
              {...form.getInputProps('seatLimit')}
            />
            <DateInput
              label="Account start date"
              valueFormat="D MMM YYYY"
              leftSection={<IconCalendar size={16} />}
              required
              {...form.getInputProps('startsOn')}
              onChange={(value) => form.setFieldValue('startsOn', value ?? '')}
            />
            <DateInput
              label="Account expiry date"
              valueFormat="D MMM YYYY"
              leftSection={<IconCalendar size={16} />}
              minDate={form.values.startsOn || undefined}
              required
              {...form.getInputProps('expiresOn')}
              onChange={(value) => form.setFieldValue('expiresOn', value ?? '')}
            />
          </SimpleGrid>
        </Fieldset>
        {withFirstAdmin && (
          <Fieldset>
            <SectionTitle>First Organisation Admin</SectionTitle>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput
                label="First name"
                required
                {...form.getInputProps('firstAdmin.firstName')}
              />
              <TextInput
                label="Last name"
                required
                {...form.getInputProps('firstAdmin.lastName')}
              />
              <TextInput
                label="Email (optional)"
                type="email"
                {...form.getInputProps('firstAdmin.email')}
              />
            </SimpleGrid>
          </Fieldset>
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={loading}>
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
