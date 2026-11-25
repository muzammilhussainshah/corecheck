'use client';

import {
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconDownload, IconFileImport } from '@tabler/icons-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  TEMPLATE_IMPORT_ROW_STATUS_LABELS,
  type TemplateImportRow,
  type TemplateImportRowStatus,
} from '@corecheck/shared';
import {
  type Column,
  DataTable,
  EmptyState,
  ErrorAlert,
  PageLoader,
  Pill,
  StatCard,
  TableCard,
  type Tone,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../../../../components/AppPageHeader';
import {
  useCommitTemplateImportMutation,
  useTemplateImportQuery,
  useUpdateTemplateImportRowMutation,
} from '../../../../../../lib/api';
import { downloadFile } from '../../../../../../lib/download';

const TONES: Record<TemplateImportRowStatus, Tone> = {
  valid: 'success',
  invalid: 'danger',
  imported: 'neutral',
};

function CorrectRowModal({
  importId,
  row,
  columns,
  onClose,
}: {
  importId: string;
  row: TemplateImportRow;
  columns: Array<{ key: string; label: string; required: boolean }>;
  onClose: () => void;
}) {
  const [values, setValues] = useState(row.data);
  const [update, { isLoading }] = useUpdateTemplateImportRowMutation();
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const result = await update({ importId, rowId: row.id, data: values });
    if (result.error) return setError((result.error as ApiError).message);
    onClose();
  };
  return (
    <Modal opened onClose={onClose} title={`Correct row ${row.rowNumber}`} size="xl">
      <Stack gap="md">
        {row.problems.map((problem) => (
          <Text key={problem} size="sm" c="red.7">
            {problem}
          </Text>
        ))}
        {error && <Alert color="red">{error}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
          {columns.map((column) => (
            <TextInput
              key={column.key}
              label={column.label}
              withAsterisk={column.required}
              value={values[column.key] ?? ''}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setValues((current) => ({ ...current, [column.key]: value }));
              }}
            />
          ))}
        </SimpleGrid>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={() => void save()}>
            Save and check
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Preview, correction and import of check templates (IMP-003..005, ITM-001..002). */
export default function TemplateImportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useTemplateImportQuery(id);
  const [commit, { isLoading: committing }] = useCommitTemplateImportMutation();
  const [editing, setEditing] = useState<TemplateImportRow | null>(null);
  const [filter, setFilter] = useState<TemplateImportRowStatus | null>(null);

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorAlert error={error as ApiError} />;

  const ready = data.groups.filter((group) => group.status === 'valid');
  const blocked = data.groups.filter((group) => group.status === 'invalid');
  const columns: Column<TemplateImportRow>[] = [
    { key: 'row', header: 'Row', width: 70, render: (row) => row.rowNumber },
    { key: 'template', header: 'Template', width: 200, render: (row) => row.data.template ?? '—' },
    {
      key: 'question',
      header: 'Question',
      render: (row) => (
        <Stack gap={0}>
          <Text size="sm">{row.data.question ?? '—'}</Text>
          <Text size="xs" c="dimmed">
            {row.data.type ?? ''}
          </Text>
        </Stack>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 170,
      render: (row) => <Pill tone={TONES[row.status]}>{TEMPLATE_IMPORT_ROW_STATUS_LABELS[row.status]}</Pill>,
    },
    {
      key: 'problems',
      header: 'Problems',
      width: 320,
      render: (row) => (
        <Stack gap={2}>
          {row.problems.map((problem) => (
            <Text key={problem} size="sm" c="red.7">
              {problem}
            </Text>
          ))}
        </Stack>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: 100,
      render: (row) =>
        row.status === 'imported' ? null : (
          <Button size="xs" variant="default" onClick={() => setEditing(row)}>
            Correct
          </Button>
        ),
    },
  ];

  return (
    <Stack gap="lg">
      <AppPageHeader
        crumbs={[
          { label: 'Templates', href: '/admin/templates' },
          { label: 'Import', href: '/admin/templates/import' },
          { label: data.fileName },
        ]}
        title={data.fileName}
        description="A template is created only when all its rows are ready. Templates are created as Drafts: review and publish them before use."
        actions={
          <Group gap="sm">
            {data.counts.invalid > 0 && (
              <Button
                variant="default"
                leftSection={<IconDownload size={16} />}
                onClick={() =>
                  void downloadFile(`/template-imports/${id}/report`, 'template-import-report.csv')
                }
              >
                Error report
              </Button>
            )}
            {ready.length > 0 && (
              <Button
                leftSection={<IconFileImport size={16} />}
                loading={committing}
                onClick={() => void commit(id)}
              >
                Create {ready.length} Draft {ready.length === 1 ? 'template' : 'templates'}
              </Button>
            )}
          </Group>
        }
      />
      {ready.length === 0 && blocked.length > 0 && (
        <Alert color="yellow" title="No templates are ready to import">
          Correct the rows below. A template is created only when all its rows are ready.
        </Alert>
      )}
      <Card withBorder>
        <Title order={4} mb="sm">
          Templates in this file
        </Title>
        <Stack gap={6}>
          {data.groups.map((group) => (
            <Group key={`${group.name}-${group.rowNumbers[0]}`} gap="sm">
              <Text size="sm" fw={600}>
                {group.name || '(no name)'}
              </Text>
              <Text size="sm" c="dimmed">
                {group.questions} question{group.questions === 1 ? '' : 's'}, rows{' '}
                {group.rowNumbers[0]}–{group.rowNumbers[group.rowNumbers.length - 1]}
              </Text>
              <Pill tone={TONES[group.status]}>
                {group.status === 'invalid' ? 'Needs correcting' : TEMPLATE_IMPORT_ROW_STATUS_LABELS[group.status]}
              </Pill>
              {group.template && (
                <Anchor component={Link} href={`/admin/templates/${group.template.id}`} size="sm">
                  Review and publish
                </Anchor>
              )}
            </Group>
          ))}
        </Stack>
      </Card>
      <SimpleGrid cols={{ base: 3 }} spacing="md">
        {(['valid', 'invalid', 'imported'] as const).map((status) => (
          <StatCard
            key={status}
            label={TEMPLATE_IMPORT_ROW_STATUS_LABELS[status]}
            value={data.counts[status]}
            selected={filter === status}
            onClick={() => setFilter(filter === status ? null : status)}
          />
        ))}
      </SimpleGrid>
      <TableCard>
        <DataTable
          columns={columns}
          rows={data.rows.filter((row) => !filter || row.status === filter)}
          rowKey={(row) => row.id}
          empty={<EmptyState title="No rows with this status" />}
        />
      </TableCard>
      {editing && (
        <CorrectRowModal importId={id} row={editing} columns={data.columns} onClose={() => setEditing(null)} />
      )}
    </Stack>
  );
}
