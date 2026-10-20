'use client';

import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { useOpenFromQuery } from '../../../lib/useOpenFromQuery';
import { IconDeviceMobile, IconPlus, IconRefresh } from '@tabler/icons-react';
import {
  type ApiError,
  POC_QUESTIONS,
  type PocCheck,
  pocCreateCheckSchema,
} from '@corecheck/shared';
import {
  type Column,
  DataTable,
  TableCard,
  EmptyState,
  ErrorAlert,
  formatDateTime,
  showApiErrors,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../components/AppPageHeader';
import {
  useCreatePocCheckMutation,
  usePocChecksQuery,
  useSitesQuery,
} from '../../../lib/api';
import { useSession } from '../../../lib/session';

function NewCheckModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const { data: sites } = useSitesQuery();
  const [create, { isLoading }] = useCreatePocCheckMutation();
  const form = useForm({
    initialValues: { siteId: '', title: 'Daily pre-use check', plantLabel: '' },
    validate: schemaResolver(pocCreateCheckSchema, { sync: true }),
  });
  const submit = form.onSubmit(async (values) => {
    const result = await create(values);
    if (result.error) return showApiErrors(form, result.error as ApiError);
    form.reset();
    onClose();
  });
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="New check for the mobile app"
    >
      <form onSubmit={submit} noValidate>
        <Stack>
          <Select
            label="Site"
            required
            data={(sites ?? []).map((s) => ({ value: s.id, label: s.name }))}
            {...form.getInputProps('siteId')}
          />
          <TextInput label="Check" required {...form.getInputProps('title')} />
          <TextInput
            label="Plant"
            required
            placeholder="e.g. Excavator EX-101"
            {...form.getInputProps('plantLabel')}
          />
          <Group justify="flex-end">
            <Button type="submit" loading={isLoading}>
              Create check
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/**
 * Offline synchronisation proof of concept (Milestone 1). Checks created here
 * are completed in the mobile app, online or offline; this page shows what
 * reached the server, by whom, and which submission won.
 */
export default function ChecksPage() {
  const { me, can } = useSession();
  const tz = me?.organisation.timeZone;
  const { data, isFetching, error, refetch } = usePocChecksQuery();
  const [creating, { open, close }] = useDisclosure();
  useOpenFromQuery(open);

  const columns: Column<PocCheck>[] = [
    {
      key: 'check',
      header: 'Check',
      render: (check) => (
        <Stack gap={0}>
          <Text fw={600} size="sm">
            {check.plantLabel}
          </Text>
          <Text size="xs" c="dimmed">
            {check.title} · {check.site.name}
          </Text>
        </Stack>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (check) =>
        check.status === 'submitted' ? (
          <Badge color="green" variant="light">
            Submitted
          </Badge>
        ) : (
          <Badge variant="light" color="gray">
            Open
          </Badge>
        ),
    },
    {
      key: 'answers',
      header: 'Answers',
      render: (check) => (
        <Stack gap={2}>
          {check.answers.map((answer) => (
            <Text key={answer.questionKey} size="xs">
              {POC_QUESTIONS.find((q) => q.key === answer.questionKey)?.label}:{' '}
              <b>{answer.value}</b> — {answer.answeredBy.name}
            </Text>
          ))}
          {check.evidence.length > 0 && (
            <Text size="xs">
              Photos: {check.evidence.length} (by{' '}
              {check.evidence.map((e) => e.uploadedBy.name).join(', ')})
            </Text>
          )}
          {check.answers.length === 0 && check.evidence.length === 0 && (
            <Text size="xs" c="dimmed">
              Nothing yet
            </Text>
          )}
        </Stack>
      ),
    },
    {
      key: 'submitted',
      header: 'Submitted',
      render: (check) =>
        check.submittedBy ? (
          <Text size="sm">
            {check.submittedBy.name}
            <br />
            {formatDateTime(check.submittedAt, tz)}
          </Text>
        ) : (
          <Text size="sm">—</Text>
        ),
    },
  ];

  return (
    <>
      <AppPageHeader
        title="Checks"
        description="Offline sync proof of concept: complete these in the CoreCheck mobile app, with or without a connection."
        actions={
          <>
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} />}
              onClick={() => refetch()}
            >
              Refresh
            </Button>
            {can('schedules.assign') && (
              <Button leftSection={<IconPlus size={16} />} onClick={open}>
                New check
              </Button>
            )}
          </>
        }
      />
      <Alert icon={<IconDeviceMobile size={18} />} mb="md" color="blue">
        Full check templates, schedules and inspections arrive in Milestone 3.
        This page demonstrates the offline sync: answers are attributed to
        whoever gave them, and when two people submit the same check the first
        submission received wins.
      </Alert>
      <TableCard>
        {error ? (
          <ErrorAlert error={error as ApiError} />
        ) : (
          <DataTable
            columns={columns}
            rows={data?.checks}
            rowKey={(check) => check.id}
            loading={isFetching}
            empty={
              <EmptyState
                title="No checks in your sites"
                message="Create one, then open the mobile app to complete it."
              />
            }
          />
        )}
      </TableCard>
      <NewCheckModal opened={creating} onClose={close} />
    </>
  );
}
