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
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  APPROVAL_MODE_LABELS,
  APPROVAL_MODES,
  type ApprovalMode,
  type CheckTemplateSummary,
} from '@corecheck/shared';
import {
  ArchivedBadge,
  type Column,
  DataTable,
  EmptyState,
  ErrorAlert,
  formatDate,
  Pill,
  SearchInput,
  showApiErrors,
  TableCard,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../../components/AppPageHeader';
import {
  useCreateTemplateMutation,
  useTemplatesQuery,
} from '../../../../lib/api';
import { useSession } from '../../../../lib/session';

function NewTemplateModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [create, { isLoading }] = useCreateTemplateMutation();
  const form = useForm({
    initialValues: {
      name: '',
      description: '',
      approvalMode: 'manual' as ApprovalMode,
    },
    validate: {
      name: (value) => (value.trim() ? null : 'Template name is required.'),
    },
  });
  const submit = form.onSubmit(async (values) => {
    const result = await create(values);
    if (result.error) return showApiErrors(form, result.error as ApiError);
    form.reset();
    onClose();
    router.push(`/admin/templates/${result.data.id}`);
  });
  return (
    <Modal opened={opened} onClose={onClose} title="New reception template">
      <form onSubmit={submit} noValidate>
        <Stack>
          <TextInput
            label="Name"
            required
            placeholder="e.g. Standard plant reception"
            {...form.getInputProps('name')}
          />
          <Textarea
            label="Description"
            autosize
            minRows={2}
            {...form.getInputProps('description')}
          />
          <Select
            label="When a reception passes"
            allowDeselect={false}
            data={APPROVAL_MODES.map((mode) => ({
              value: mode,
              label: APPROVAL_MODE_LABELS[mode],
            }))}
            {...form.getInputProps('approvalMode')}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={isLoading}>
              Create and add questions
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Reception templates (FRD 10): drafts and published versions. */
export default function TemplatesPage() {
  const router = useRouter();
  const { can } = useSession();
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, { open, close }] = useDisclosure();
  const { data, isFetching, error } = useTemplatesQuery({
    purpose: 'reception',
    includeArchived: showArchived,
  });
  const term = search.trim().toLowerCase();
  const rows = term
    ? data?.filter((item) => item.name.toLowerCase().includes(term))
    : data;

  const columns: Column<CheckTemplateSummary>[] = [
    {
      key: 'name',
      header: 'Template',
      render: (item) => (
        <Stack gap={0}>
          <Group gap={6}>
            <Text fw={600} size="sm">
              {item.name}
            </Text>
            {item.archivedAt && <ArchivedBadge />}
          </Group>
          {item.description && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {item.description}
            </Text>
          )}
        </Stack>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 240,
      render: (item) => (
        <Group gap={6} wrap="nowrap">
          {item.publishedVersion ? (
            <Pill tone="success">Published v{item.publishedVersion}</Pill>
          ) : null}
          {item.hasDraft && <Pill tone="info">Draft</Pill>}
        </Group>
      ),
    },
    {
      key: 'questions',
      header: 'Questions',
      align: 'right',
      width: 110,
      render: (item) => <Text size="sm">{item.questionCount}</Text>,
    },
    {
      key: 'updated',
      header: 'Updated',
      width: 130,
      render: (item) => <Text size="sm">{formatDate(item.updatedAt)}</Text>,
    },
  ];

  return (
    <>
      <AppPageHeader
        title="Reception templates"
        description="The questions asked when plant arrives. Published versions never change; editing starts a new version."
        actions={
          can('templates.manage') && (
            <Button leftSection={<IconPlus size={16} />} onClick={open}>
              Add template
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
              placeholder="Search templates"
            />
            <Switch
              label="Show archived"
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
            rows={rows}
            rowKey={(item) => item.id}
            loading={isFetching}
            onRowClick={(item) => router.push(`/admin/templates/${item.id}`)}
            empty={
              <EmptyState
                title="No reception templates yet"
                message="Create one so plant can go through reception."
              />
            }
          />
        )}
      </TableCard>
      <NewTemplateModal opened={creating} onClose={close} />
    </>
  );
}
