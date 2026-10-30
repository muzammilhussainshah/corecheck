'use client';

import {
  Anchor,
  Button,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconDownload, IconFileImport } from '@tabler/icons-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  IMPORT_ROW_STATUS_LABELS,
  type ImportRowStatus,
  type PlantImportRow,
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
import { AppPageHeader } from '../../../../../components/AppPageHeader';
import {
  useCommitPlantImportMutation,
  usePlantImportQuery,
  useUpdatePlantImportRowMutation,
} from '../../../../../lib/api';
import { downloadFile } from '../../../../../lib/download';
import { useSession } from '../../../../../lib/session';

const TONES: Record<ImportRowStatus, Tone> = {
  valid: 'success',
  warning: 'warning',
  invalid: 'danger',
  imported: 'neutral',
};

const STATS: Array<{ status: ImportRowStatus; label: string }> = [
  { status: 'valid', label: 'Ready' },
  { status: 'warning', label: 'Possible duplicates' },
  { status: 'invalid', label: 'Need correcting' },
  { status: 'imported', label: 'Imported' },
];

function CorrectRowModal({
  importId,
  row,
  columns,
  onClose,
}: {
  importId: string;
  row: PlantImportRow;
  columns: Array<{ key: string; label: string; required: boolean }>;
  onClose: () => void;
}) {
  const [values, setValues] = useState(row.data);
  const [update, { isLoading }] = useUpdatePlantImportRowMutation();

  const save = async () => {
    const result = await update({ importId, rowId: row.id, data: values });
    if (!result.error) onClose();
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={`Correct row ${row.rowNumber}`}
      size="lg"
    >
      <Stack gap="md">
        {row.problems.map((problem) => (
          <Text key={problem} size="sm" c="red.7">
            {problem}
          </Text>
        ))}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
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

/** Row-by-row preview, correction and import (IMP-003 to IMP-005). */
export default function PlantImportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data, isLoading, error } = usePlantImportQuery(id);
  const [commit, { isLoading: committing }] = useCommitPlantImportMutation();
  const [update, { isLoading: confirming }] = useUpdatePlantImportRowMutation();
  const [editing, setEditing] = useState<PlantImportRow | null>(null);
  const [filter, setFilter] = useState<ImportRowStatus | null>(null);

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorAlert error={error as ApiError} />;

  const columns: Column<PlantImportRow>[] = [
    { key: 'row', header: 'Row', render: (row) => row.rowNumber, width: 70 },
    {
      key: 'name',
      header: 'Equipment',
      render: (row) => row.data.name ?? '—',
    },
    {
      key: 'site',
      header: 'Site',
      render: (row) => row.data.site ?? '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Pill tone={TONES[row.status]}>
          {row.status === 'valid' && row.confirmed
            ? 'Confirmed'
            : IMPORT_ROW_STATUS_LABELS[row.status]}
        </Pill>
      ),
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (row) => (
        <Stack gap={2}>
          {[...row.problems, ...row.warnings].map((note) => (
            <Text key={note} size="sm">
              {note}
            </Text>
          ))}
          {row.existingPlant && row.status !== 'imported' && (
            <Anchor
              component={Link}
              href={`/plant/${row.existingPlant.id}`}
              size="sm"
            >
              Open {row.existingPlant.assetId}
            </Anchor>
          )}
          {row.plant && (
            <Anchor component={Link} href={`/plant/${row.plant.id}`} size="sm">
              {row.plant.assetId}
            </Anchor>
          )}
        </Stack>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        row.status === 'imported' ? null : (
          <Group gap="xs" justify="flex-end" wrap="nowrap">
            {row.status === 'warning' && (
              <Button
                size="xs"
                variant="light"
                loading={confirming}
                onClick={() => {
                  void update({ importId: id, rowId: row.id, confirmed: true });
                }}
              >
                Import anyway
              </Button>
            )}
            <Button size="xs" variant="default" onClick={() => setEditing(row)}>
              Correct
            </Button>
          </Group>
        ),
    },
  ];

  const { counts } = data;
  const waiting = counts.warning + counts.invalid;

  return (
    <Stack gap="lg">
      <AppPageHeader
        crumbs={[
          { label: 'Plant', href: '/plant' },
          { label: 'Import', href: '/plant/import' },
          { label: data.fileName },
        ]}
        title={data.fileName}
        description="Rows that need attention stay here until they are corrected, so you never upload the file again."
        actions={
          <Group gap="sm">
            {waiting > 0 && (
              <Button
                variant="default"
                leftSection={<IconDownload size={16} />}
                onClick={() =>
                  void downloadFile(
                    `/plant-imports/${id}/report`,
                    'plant-import-report.csv',
                  )
                }
              >
                Error report
              </Button>
            )}
            {can('plant.create') && (
              <Button
                leftSection={<IconFileImport size={16} />}
                disabled={counts.valid === 0}
                loading={committing}
                onClick={() => {
                  void commit(id);
                }}
              >
                Import {counts.valid} ready{' '}
                {counts.valid === 1 ? 'row' : 'rows'}
              </Button>
            )}
          </Group>
        }
      />
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        {STATS.map(({ status, label }) => (
          <StatCard
            key={status}
            label={label}
            value={counts[status]}
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
        <CorrectRowModal
          importId={id}
          row={editing}
          columns={data.columns}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}
