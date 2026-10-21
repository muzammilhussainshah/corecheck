'use client';

import {
  Box,
  Button,
  Group,
  MultiSelect,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { IconUserPlus } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  createUserSchema,
  type UserWithCredentials,
} from '@corecheck/shared';
import { COLORS, CredentialsCard, Pill, showApiErrors } from '@corecheck/ui';
import { AppPageHeader } from '../../../../../components/AppPageHeader';
import {
  useCreateUserMutation,
  useSeatUsageQuery,
} from '../../../../../lib/api';
import { useRoleOptions, useScopeOptions } from '../../../../../lib/options';
import { useSession } from '../../../../../lib/session';

interface NewUserValues {
  firstName: string;
  lastName: string;
  email: string;
  roleId: string;
  siteIds: string[];
  teamIds: string[];
  disciplineIds: string[];
}

const EMPTY: NewUserValues = {
  firstName: '',
  lastName: '',
  email: '',
  roleId: '',
  siteIds: [],
  teamIds: [],
  disciplineIds: [],
};

/**
 * Adds a user on its own page, as CoreStock does. CoreCheck generates the
 * username and a temporary PIN (USR-001, USR-003) and shows them once.
 */
export default function NewUserPage() {
  const router = useRouter();
  const { me, can } = useSession();
  const [createUser, { isLoading }] = useCreateUserMutation();
  const { data: seats } = useSeatUsageQuery();
  const [created, setCreated] = useState<UserWithCredentials | null>(null);
  const roles = useRoleOptions();
  const scope = useScopeOptions();
  const form = useForm<NewUserValues>({
    initialValues: EMPTY,
    validate: schemaResolver(createUserSchema, { sync: true }),
  });

  const submit = form.onSubmit(async (values) => {
    const result = await createUser(values);
    if (result.error) return showApiErrors(form, result.error as ApiError);
    setCreated(result.data);
  });

  const canScope = can('users.assign_scope');
  const seatsFull = seats?.available === 0;

  return (
    <>
      <AppPageHeader
        crumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Manage', href: '/admin/users' },
          { label: 'Add New' },
        ]}
        title={created ? 'User created' : 'New user'}
        description={
          created
            ? 'Give these sign-in details to the user now.'
            : 'CoreCheck creates the username from the name and issues a temporary PIN.'
        }
      />
      <Paper withBorder shadow="sm" p="lg">
        {created ? (
          <Stack>
            <CredentialsCard
              credentials={created.credentials}
              personName={`${created.user.firstName} ${created.user.lastName}`}
              timeZone={me?.organisation.timeZone}
            />
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  form.reset();
                  setCreated(null);
                }}
              >
                Add another
              </Button>
              <Button
                variant="default"
                onClick={() => router.push('/admin/users')}
              >
                Back to users
              </Button>
              <Button
                onClick={() => router.push(`/admin/users/${created.user.id}`)}
              >
                Open user
              </Button>
            </Group>
          </Stack>
        ) : (
          <form onSubmit={submit} noValidate>
            <Group justify="space-between" mb="md">
              <Title order={3} fz={20} c={COLORS.title}>
                User details
              </Title>
              {seats && (
                <Pill tone={seatsFull ? 'danger' : 'info'}>
                  {seats.used} of {seats.limit} seats in use
                </Pill>
              )}
            </Group>
            {seatsFull && (
              <Text c="red.7" fz="sm" mb="md">
                All licensed seats are in use. Deactivate a user or contact
                CoreCheck to add seats.
              </Text>
            )}
            <Box
              p="md"
              style={{
                border: `1px solid ${COLORS.border}`,
                borderRadius: 16,
                backgroundColor: COLORS.panel,
              }}
            >
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                <TextInput
                  label="First name"
                  placeholder="e.g. Sarah"
                  required
                  {...form.getInputProps('firstName')}
                />
                <TextInput
                  label="Last name"
                  placeholder="e.g. Khan"
                  required
                  {...form.getInputProps('lastName')}
                />
                <TextInput
                  label="Email"
                  placeholder="user@company.com"
                  description="Optional. Used for notifications, never for signing in."
                  type="email"
                  {...form.getInputProps('email')}
                />
                <Select
                  label="Role"
                  placeholder="Select role"
                  required
                  data={roles}
                  searchable
                  {...form.getInputProps('roleId')}
                />
                {canScope && (
                  <>
                    <MultiSelect
                      label="Sites"
                      placeholder="Select sites"
                      description={
                        me?.scope.orgWide
                          ? undefined
                          : 'You can assign your own sites.'
                      }
                      data={scope.sites}
                      searchable
                      required={!me?.scope.orgWide}
                      {...form.getInputProps('siteIds')}
                    />
                    <MultiSelect
                      label="Teams"
                      placeholder="Select teams"
                      data={scope.teams}
                      searchable
                      {...form.getInputProps('teamIds')}
                    />
                    <MultiSelect
                      label="Disciplines"
                      placeholder="Select disciplines"
                      data={scope.disciplines}
                      searchable
                      {...form.getInputProps('disciplineIds')}
                    />
                  </>
                )}
              </SimpleGrid>
            </Box>
            <Group justify="flex-end" mt="lg">
              <Button variant="default" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={isLoading}
                disabled={seatsFull}
                leftSection={<IconUserPlus size={16} />}
              >
                Create user
              </Button>
            </Group>
          </form>
        )}
      </Paper>
    </>
  );
}
