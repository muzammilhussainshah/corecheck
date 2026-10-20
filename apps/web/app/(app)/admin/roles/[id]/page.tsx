'use client';

import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  Stack,
  Switch,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import {
  IconArchive,
  IconCopy,
  IconInfoCircle,
  IconRestore,
} from '@tabler/icons-react';
import { useParams, useRouter } from 'next/navigation';
import {
  type ApiError,
  isPrivilegedRole,
  type PermissionCode,
  type RoleSummary,
} from '@corecheck/shared';
import {
  ArchivedBadge,
  confirmAction,
  ErrorAlert,
  showApiErrors,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../../../components/AppPageHeader';
import { PermissionMatrix } from '../../../../../components/roles/PermissionMatrix';
import {
  useDuplicateRoleMutation,
  useRoleQuery,
  useSetRoleArchivedMutation,
  useUpdateRoleMutation,
} from '../../../../../lib/api';
import { useSession } from '../../../../../lib/session';

function DuplicateModal({
  role,
  opened,
  onClose,
}: {
  role: RoleSummary;
  opened: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [duplicate, { isLoading }] = useDuplicateRoleMutation();
  const form = useForm({ initialValues: { name: `${role.name} (copy)` } });
  const submit = form.onSubmit(async ({ name }) => {
    const result = await duplicate({ id: role.id, name });
    if (result.error) return showApiErrors(form, result.error as ApiError);
    onClose();
    router.push(`/admin/roles/${result.data.id}`);
  });
  return (
    <Modal opened={opened} onClose={onClose} title={`Duplicate ${role.name}`}>
      <form onSubmit={submit}>
        <Stack>
          <TextInput
            label="New role name"
            required
            {...form.getInputProps('name')}
          />
          <Group justify="flex-end">
            <Button type="submit" loading={isLoading}>
              Duplicate
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function RoleEditor({
  role,
  canManage,
}: {
  role: RoleSummary;
  canManage: boolean;
}) {
  const [update, { isLoading }] = useUpdateRoleMutation();
  const editable = canManage && !role.isStandard && !role.archivedAt;
  const form = useForm({
    initialValues: {
      name: role.name,
      description: role.description,
      orgWideScope: role.orgWideScope,
      permissions: role.permissions as PermissionCode[],
    },
  });
  const privileged = isPrivilegedRole({
    standardKey: role.standardKey,
    permissions: form.values.permissions,
  });

  const submit = form.onSubmit(async (values) => {
    const result = await update({ id: role.id, ...values });
    if (result.error) return showApiErrors(form, result.error as ApiError);
    form.resetDirty(values);
  });

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Card withBorder>
          <Stack>
            <TextInput
              label="Name"
              disabled={!editable}
              {...form.getInputProps('name')}
            />
            <Textarea
              label="Description"
              autosize
              minRows={2}
              disabled={!editable}
              {...form.getInputProps('description')}
            />
            <Switch
              label="Organisation-wide access"
              description="Off: holders see only the sites, teams and disciplines assigned to them."
              disabled={!editable}
              {...form.getInputProps('orgWideScope', { type: 'checkbox' })}
            />
            {privileged && (
              <Alert color="orange" icon={<IconInfoCircle size={18} />}>
                This role is privileged: it can manage users, roles or settings.
                Only Admins can give it to someone.
              </Alert>
            )}
          </Stack>
        </Card>
        <Title order={4}>Permissions</Title>
        <PermissionMatrix
          value={form.values.permissions}
          readOnly={!editable}
          onChange={(next) => form.setFieldValue('permissions', next)}
        />
        {editable && (
          <Group justify="flex-end" pos="sticky" bottom={16}>
            <Button
              type="submit"
              loading={isLoading}
              disabled={!form.isDirty()}
              size="md"
            >
              Save role
            </Button>
          </Group>
        )}
      </Stack>
    </form>
  );
}

export default function RolePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data: role, error, isLoading } = useRoleQuery(id);
  const [setArchived] = useSetRoleArchivedMutation();
  const [duplicating, { open, close }] = useDisclosure();
  const canManage = can('roles.manage');

  if (isLoading)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  if (error || !role)
    return (
      <ErrorAlert
        error={error as ApiError}
        title="This role could not be shown"
      />
    );

  const archive = (archived: boolean) => async () => {
    await setArchived({ id: role.id, archived });
  };

  return (
    <>
      <AppPageHeader
        crumbs={[
          { label: 'Roles', href: '/admin/roles' },
          { label: role.name },
        ]}
        title={
          <Group gap="sm">
            {role.name}
            <Badge variant="outline">
              {role.isStandard ? 'Standard' : 'Custom'}
            </Badge>
            {role.archivedAt && <ArchivedBadge />}
          </Group>
        }
        description={`${role.activeUserCount} active ${role.activeUserCount === 1 ? 'user' : 'users'}`}
        actions={
          canManage && (
            <>
              <Button
                variant="default"
                leftSection={<IconCopy size={16} />}
                onClick={open}
              >
                Duplicate
              </Button>
              {!role.isStandard && !role.archivedAt && (
                <Button
                  variant="light"
                  color="red"
                  leftSection={<IconArchive size={16} />}
                  onClick={() =>
                    confirmAction({
                      title: 'Archive role?',
                      message:
                        'Archived roles cannot be given to anyone. Users must be moved to another role first.',
                      confirmLabel: 'Archive',
                      danger: true,
                      onConfirm: archive(true),
                    })
                  }
                >
                  Archive
                </Button>
              )}
              {role.archivedAt && (
                <Button
                  variant="default"
                  leftSection={<IconRestore size={16} />}
                  onClick={archive(false)}
                >
                  Restore
                </Button>
              )}
            </>
          )
        }
      />
      {role.isStandard && (
        <Alert color="blue" icon={<IconInfoCircle size={18} />} mb="md">
          Standard roles follow the CoreCheck permission model and cannot be
          edited. Duplicate this role to make a custom version.
        </Alert>
      )}
      <RoleEditor
        key={`${role.id}-${role.archivedAt}`}
        role={role}
        canManage={canManage}
      />
      <DuplicateModal role={role} opened={duplicating} onClose={close} />
    </>
  );
}
