'use client';

import {
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import {
  IconArchive,
  IconKey,
  IconLockOpen,
  IconPlayerPause,
  IconPlayerPlay,
} from '@tabler/icons-react';
import { useParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import {
  type ApiError,
  type IssuedCredentials,
  type OrganisationDetail,
  updateOrganisationSchema,
} from '@corecheck/shared';
import {
  CredentialsCard,
  type DetailItem,
  DetailList,
  ErrorAlert,
  formatBytes,
  formatDate,
  formatDateTime,
  OrganisationStatusBadge,
  plural,
  showApiErrors,
  UserStatusBadge,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../../components/AppPageHeader';
import {
  OrganisationForm,
  type OrganisationValues,
} from '../../../../components/OrganisationForm';
import {
  useChangeOrganisationStatusMutation,
  useMeQuery,
  useOrganisationAdminsQuery,
  useOrganisationQuery,
  useResetAdminPinMutation,
  useUnlockAdminMutation,
  useUpdateOrganisationMutation,
} from '../../../../lib/api';

type StatusAction = 'suspend' | 'activate' | 'archive';

const STATUS_COPY: Record<
  StatusAction,
  { title: string; body: string; button: string; danger: boolean }
> = {
  suspend: {
    title: 'Suspend organisation',
    body: 'All users are signed out at once and cannot sign in until it is activated again. Data is kept.',
    button: 'Suspend',
    danger: true,
  },
  activate: {
    title: 'Activate organisation',
    body: 'Users can sign in again.',
    button: 'Activate',
    danger: false,
  },
  archive: {
    title: 'Archive organisation',
    body: 'All users are signed out and cannot sign in. Data is kept under the retention policy.',
    button: 'Archive',
    danger: true,
  },
};

function EditForm({ org }: { org: OrganisationDetail }) {
  const [update, { isLoading }] = useUpdateOrganisationMutation();
  const form = useForm<OrganisationValues>({
    initialValues: {
      name: org.name,
      industry: org.industry,
      contactName: org.contactName,
      contactEmail: org.contactEmail,
      contactPhone: org.contactPhone,
      address: org.address,
      country: org.country,
      timeZone: org.timeZone,
      seatLimit: org.seatLimit,
      startsOn: org.startsOn,
      expiresOn: org.expiresOn,
    },
    validate: schemaResolver(updateOrganisationSchema, { sync: true }),
  });
  const submit = form.onSubmit(async (values) => {
    const result = await update({
      id: org.id,
      ...values,
      seatLimit: Number(values.seatLimit),
    });
    if (result.error) return showApiErrors(form, result.error as ApiError);
  });
  return (
    <OrganisationForm
      form={form}
      onSubmit={submit}
      submitLabel="Save changes"
      loading={isLoading}
    />
  );
}

export default function OrganisationPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMeQuery();
  const { data: org, error, isLoading } = useOrganisationQuery(id);
  const { data: admins } = useOrganisationAdminsQuery(id);
  const [changeStatus, { isLoading: changing }] =
    useChangeOrganisationStatusMutation();
  const [resetPin] = useResetAdminPinMutation();
  const [unlock] = useUnlockAdminMutation();
  const [pendingAction, setPendingAction] = useState<StatusAction | null>(null);
  const [reason, setReason] = useState('');
  const [issued, setIssued] = useState<{
    name: string;
    credentials: IssuedCredentials;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const canChange = me?.staffRole === 'owner' || me?.staffRole === 'admin';

  if (isLoading)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  if (error || !org)
    return (
      <ErrorAlert
        error={error as ApiError}
        title="This organisation could not be shown"
      />
    );

  const runStatus = async () => {
    if (!pendingAction) return;
    await changeStatus({
      id: org.id,
      action: pendingAction,
      reason: reason || undefined,
    });
    setPendingAction(null);
    setReason('');
  };

  const statusButtons: Array<[StatusAction, ReactNode]> = [];
  if (org.status === 'active')
    statusButtons.push(['suspend', <IconPlayerPause size={16} key="s" />]);
  if (org.status !== 'active')
    statusButtons.push(['activate', <IconPlayerPlay size={16} key="a" />]);
  if (org.status !== 'archived')
    statusButtons.push(['archive', <IconArchive size={16} key="r" />]);

  const facts: DetailItem[] = [
    {
      label: 'Seats',
      value: `${org.usage.seatsUsed} of ${org.seatLimit} in use`,
    },
    {
      label: 'Users',
      value: `${org.usage.activeUsers} active · ${org.usage.lockedUsers} locked · ${org.usage.inactiveUsers} inactive`,
    },
    {
      label: 'Account dates',
      value: `${formatDate(org.startsOn)} – ${formatDate(org.expiresOn)}`,
    },
    { label: 'Plant', value: plural(org.usage.plants, 'item') },
    {
      label: 'Storage',
      value: `${plural(org.usage.storedFiles, 'file')} · ${formatBytes(org.usage.storageBytes)}`,
    },
    { label: 'Time zone', value: org.timeZone },
    {
      label: 'Primary contact',
      value: (
        <>
          {org.contactName}
          <br />
          {org.contactEmail}
          <br />
          {org.contactPhone}
        </>
      ),
    },
    { label: 'Address', value: org.address },
    { label: 'Created', value: formatDateTime(org.createdAt) },
  ];

  return (
    <>
      <AppPageHeader
        crumbs={[
          { label: 'Organisations', href: '/organisations' },
          { label: org.name },
        ]}
        title={
          <Group gap="sm">
            {org.name}
            <OrganisationStatusBadge status={org.status} />
            {org.expired && (
              <Badge color="orange" variant="light">
                Expired · read-only
              </Badge>
            )}
          </Group>
        }
        description={`${org.industry} · ${org.country}`}
        actions={
          canChange && (
            <>
              <Button
                variant="default"
                onClick={() => setEditing((value) => !value)}
              >
                {editing ? 'Close editor' : 'Edit'}
              </Button>
              {statusButtons.map(([action, icon]) => (
                <Button
                  key={action}
                  variant={STATUS_COPY[action].danger ? 'light' : 'filled'}
                  color={
                    action === 'suspend'
                      ? 'orange'
                      : STATUS_COPY[action].danger
                        ? 'red'
                        : undefined
                  }
                  leftSection={icon}
                  onClick={() => setPendingAction(action)}
                >
                  {STATUS_COPY[action].button}
                </Button>
              ))}
            </>
          )
        }
      />

      {editing ? (
        <EditForm org={org} />
      ) : (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Card withBorder>
            <Title order={4} mb="md">
              Account and usage
            </Title>
            <DetailList items={facts} />
          </Card>
          <Card withBorder>
            <Title order={4} mb="md">
              Organisation Admins
            </Title>
            <Stack gap={0}>
              {(admins ?? []).map((admin, index) => {
                const name = `${admin.firstName} ${admin.lastName}`;
                return (
                  <Group
                    key={admin.id}
                    justify="space-between"
                    wrap="wrap"
                    py="sm"
                    style={
                      index > 0
                        ? {
                            borderTop:
                              '1px solid var(--mantine-color-default-border)',
                          }
                        : undefined
                    }
                  >
                    <Stack gap={2}>
                      <Group gap="xs">
                        <Text size="sm" fw={600}>
                          {name}
                        </Text>
                        <UserStatusBadge status={admin.status} />
                      </Group>
                      <Text size="xs" c="dimmed">
                        {admin.username} · Last sign-in{' '}
                        {formatDateTime(admin.lastLoginAt)}
                      </Text>
                    </Stack>
                    {canChange && (
                      <Group gap="xs">
                        {admin.status === 'locked' && (
                          <Button
                            size="xs"
                            variant="default"
                            leftSection={<IconLockOpen size={14} />}
                            onClick={async () => {
                              await unlock({
                                orgId: org.id,
                                userId: admin.id,
                              });
                            }}
                          >
                            Unlock
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="default"
                          leftSection={<IconKey size={14} />}
                          onClick={async () => {
                            const result = await resetPin({
                              orgId: org.id,
                              userId: admin.id,
                            });
                            if (!result.error)
                              setIssued({
                                name,
                                credentials: result.data.credentials,
                              });
                          }}
                        >
                          Reset PIN
                        </Button>
                      </Group>
                    )}
                  </Group>
                );
              })}
            </Stack>
            <Text size="xs" c="dimmed" mt="sm">
              You can reset or unlock an Admin. Customer records are not visible
              here.
            </Text>
          </Card>
        </SimpleGrid>
      )}

      <Modal
        opened={!!pendingAction}
        onClose={() => setPendingAction(null)}
        title={pendingAction ? STATUS_COPY[pendingAction].title : ''}
      >
        {pendingAction && (
          <Stack>
            <Text size="sm">{STATUS_COPY[pendingAction].body}</Text>
            <Textarea
              label="Reason (recorded in the audit trail)"
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              autosize
              minRows={2}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPendingAction(null)}>
                Cancel
              </Button>
              <Button
                color={STATUS_COPY[pendingAction].danger ? 'red' : undefined}
                loading={changing}
                onClick={runStatus}
              >
                {STATUS_COPY[pendingAction].button}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={!!issued}
        onClose={() => setIssued(null)}
        title="New temporary PIN"
        size="lg"
      >
        {issued && (
          <CredentialsCard
            credentials={issued.credentials}
            personName={issued.name}
          />
        )}
      </Modal>
    </>
  );
}
