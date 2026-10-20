'use client';

import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { useOpenFromQuery } from '../../../../lib/useOpenFromQuery';
import { IconPlus } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  createRoleSchema,
  type RoleSummary,
} from '@corecheck/shared';
import {
  ArchivedBadge,
  type Column,
  DataTable,
  EmptyState,
  ErrorAlert,
  Pill,
  SearchInput,
  showApiErrors,
  TableCard,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../../components/AppPageHeader';
import {
  useCreateRoleMutation,
  useDuplicateRoleMutation,
  useRolesQuery,
} from '../../../../lib/api';
import { useSession } from '../../../../lib/session';

function NewRoleModal({
  opened,
  onClose,
  roles,
}: {
  opened: boolean;
  onClose: () => void;
  roles: RoleSummary[];
}) {
  const router = useRouter();
  const [createRole, creating] = useCreateRoleMutation();
  const [duplicateRole, duplicating] = useDuplicateRoleMutation();
  const form = useForm({
    initialValues: {
      name: '',
      description: '',
      orgWideScope: false,
      permissions: [] as string[],
      copyFrom: null as string | null,
    },
    validate: schemaResolver(createRoleSchema, { sync: true }),
  });

  const submit = form.onSubmit(async ({ copyFrom, ...values }) => {
    const result = copyFrom
      ? await duplicateRole({ id: copyFrom, name: values.name })
      : await createRole(values);
    if (result.error) return showApiErrors(form, result.error as ApiError);
    onClose();
    router.push(`/admin/roles/${result.data.id}`);
  });

  return (
    <Modal opened={opened} onClose={onClose} title="New custom role">
      <form onSubmit={submit} noValidate>
        <Stack>
          <TextInput
            label="Name"
            required
            placeholder="e.g. Viewer"
            {...form.getInputProps('name')}
          />
          <Select
            label="Start from"
            description="Copy the permissions of an existing role, or start empty and choose them next."
            placeholder="Empty role"
            clearable
            data={roles.map((role) => ({ value: role.id, label: role.name }))}
            {...form.getInputProps('copyFrom')}
          />
          {!form.values.copyFrom && (
            <>
              <Textarea
                label="Description"
                autosize
                minRows={2}
                {...form.getInputProps('description')}
              />
              <Switch
                label="Organisation-wide access"
                description="Off: holders see only the sites, teams and disciplines assigned to them."
                {...form.getInputProps('orgWideScope', { type: 'checkbox' })}
              />
            </>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={creating.isLoading || duplicating.isLoading}
            >
              Create and choose permissions
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default function RolesPage() {
  const router = useRouter();
  const { can } = useSession();
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, { open, close }] = useDisclosure();
  useOpenFromQuery(open);
  const {
    data: roles,
    isFetching,
    error,
  } = useRolesQuery({ includeArchived: showArchived });
  const term = search.trim().toLowerCase();
  const visibleRoles = term
    ? roles?.filter((role) => role.name.toLowerCase().includes(term))
    : roles;

  const columns: Column<RoleSummary>[] = [
    {
      key: 'name',
      header: 'Role',
      render: (role) => (
        <Stack gap={0}>
          <Group gap={6}>
            <Text fw={600} size="sm">
              {role.name}
            </Text>
            {role.archivedAt && <ArchivedBadge />}
          </Group>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {role.description}
          </Text>
        </Stack>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 220,
      render: (role) => (
        <Group gap={6} wrap="nowrap">
          <Pill tone={role.isStandard ? 'neutral' : 'info'}>
            {role.isStandard ? 'Standard' : 'Custom'}
          </Pill>
          {role.privileged && <Pill tone="warning">Privileged</Pill>}
        </Group>
      ),
    },
    {
      key: 'scope',
      header: 'Access',
      width: 190,
      render: (role) => (
        <Text size="sm">
          {role.orgWideScope ? 'Whole organisation' : 'Assigned scope'}
        </Text>
      ),
    },
    {
      key: 'permissions',
      header: 'Permissions',
      align: 'right',
      width: 130,
      render: (role) => <Text size="sm">{role.permissions.length}</Text>,
    },
    {
      key: 'users',
      header: 'Users',
      align: 'right',
      width: 90,
      render: (role) => <Text size="sm">{role.activeUserCount}</Text>,
    },
  ];

  return (
    <>
      <AppPageHeader
        title="Roles"
        description="Standard roles are fixed. Build custom roles, such as a read-only Viewer, from the same permissions."
        actions={
          can('roles.manage') && (
            <Button leftSection={<IconPlus size={16} />} onClick={open}>
              Add New Role
            </Button>
          )
        }
      />
      <TableCard
        toolbar={
          <>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search roles"
            />
            <Switch
              label="Show archived roles"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.currentTarget.checked)}
            />
          </>
        }
      >
        {error ? (
          <ErrorAlert error={error as ApiError} />
        ) : (
          <DataTable
            columns={columns}
            rows={visibleRoles}
            rowKey={(role) => role.id}
            loading={isFetching}
            onRowClick={(role) => router.push(`/admin/roles/${role.id}`)}
            empty={<EmptyState title="No roles" />}
          />
        )}
      </TableCard>
      {can('roles.manage') && roles && (
        <NewRoleModal opened={creating} onClose={close} roles={roles} />
      )}
    </>
  );
}
