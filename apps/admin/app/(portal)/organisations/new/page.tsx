'use client';

import { Button, Card, Group, Stack, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import Link from 'next/link';
import { useState } from 'react';
import {
  type ApiError,
  type CreateOrganisationResponse,
  createOrganisationSchema,
} from '@corecheck/shared';
import { CredentialsCard, showApiErrors } from '@corecheck/ui';
import { AppPageHeader } from '../../../../components/AppPageHeader';
import {
  OrganisationForm,
  type OrganisationValues,
} from '../../../../components/OrganisationForm';
import { useCreateOrganisationMutation } from '../../../../lib/api';

const DEFAULT_TIME_ZONE = 'Europe/London';

/**
 * Today's date in the organisation's time zone, as YYYY-MM-DD. Account dates
 * are calendar days there (NFR-005), not in the browser's zone.
 */
const dateIn = (timeZone: string, yearsAhead = 0) => {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone })
    .format(new Date())
    .split('-');
  // 29 February has no anniversary in most years.
  const safeDay = yearsAhead && month === '02' && day === '29' ? '28' : day;
  return `${Number(year) + yearsAhead}-${month}-${safeDay}`;
};

/** Provision a customer organisation and its first Admin (IAD-002, IAD-010). */
export default function NewOrganisationPage() {
  const [create, { isLoading }] = useCreateOrganisationMutation();
  const [created, setCreated] = useState<CreateOrganisationResponse | null>(
    null,
  );
  const form = useForm<OrganisationValues>({
    initialValues: {
      name: '',
      industry: '',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      address: '',
      country: 'United Kingdom',
      timeZone: DEFAULT_TIME_ZONE,
      seatLimit: 10,
      startsOn: dateIn(DEFAULT_TIME_ZONE),
      expiresOn: dateIn(DEFAULT_TIME_ZONE, 1),
      firstAdmin: { firstName: '', lastName: '', email: '' },
    },
    validate: schemaResolver(createOrganisationSchema, { sync: true }),
  });

  const submit = form.onSubmit(async (values) => {
    const result = await create({
      ...values,
      seatLimit: Number(values.seatLimit),
      firstAdmin: values.firstAdmin!,
    });
    if (result.error) return showApiErrors(form, result.error as ApiError);
    setCreated(result.data);
  });

  if (created) {
    const admin = created.firstAdmin;
    return (
      <>
        <AppPageHeader
          crumbs={[
            { label: 'Organisations', href: '/organisations' },
            { label: 'New' },
          ]}
          title={`${created.organisation.name} is ready`}
        />
        <Card withBorder maw={640}>
          <Stack>
            <Title order={4}>First Organisation Admin</Title>
            <CredentialsCard
              credentials={created.credentials}
              personName={`${admin.firstName} ${admin.lastName}`}
            />
            <Group>
              <Button
                component={Link}
                href={`/organisations/${created.organisation.id}`}
              >
                Open organisation
              </Button>
            </Group>
          </Stack>
        </Card>
      </>
    );
  }

  return (
    <>
      <AppPageHeader
        crumbs={[
          { label: 'Organisations', href: '/organisations' },
          { label: 'New' },
        ]}
        title="New organisation"
        description="Creates an isolated workspace with the standard roles, default disciplines and its first Admin."
      />
      <OrganisationForm
        form={form}
        onSubmit={submit}
        submitLabel="Create organisation"
        loading={isLoading}
        withFirstAdmin
      />
    </>
  );
}
