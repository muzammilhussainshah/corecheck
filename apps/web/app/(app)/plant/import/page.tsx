'use client';

import { Button, Card, FileInput, Group, Stack, Text } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  PLANT_IMPORT_MAX_ROWS,
  type PlantImportSummary,
} from '@corecheck/shared';
import {
  type Column,
  DataTable,
  EmptyState,
  ErrorAlert,
  formatDateTime,
  TableCard,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../../components/AppPageHeader';
import {
  usePlantImportsQuery,
  useUploadPlantImportMutation,
} from '../../../../lib/api';
import { downloadFile } from '../../../../lib/download';
import { useSession } from '../../../../lib/session';

const COLUMNS: Column<PlantImportSummary>[] = [
  { key: 'file', header: 'File', render: (row) => row.fileName },
  { key: 'by', header: 'Imported by', render: (row) => row.createdBy },
  {
    key: 'when',
    header: 'When',
    render: (row) => formatDateTime(row.createdAt),
  },
  {
    key: 'imported',
    header: 'Imported',
    align: 'right',
    render: (row) => row.counts.imported,
  },
  {
    key: 'waiting',
    header: 'Waiting',
    align: 'right',
    render: (row) => row.counts.valid + row.counts.warning + row.counts.invalid,
  },
];

/** Upload a plant file, and every earlier import (IMP-001, IMP-006). */
export default function PlantImportPage() {
  const router = useRouter();
  const { can } = useSession();
  const allowed = can('plant.import');
  const { data, isLoading, error } = usePlantImportsQuery(undefined, {
    skip: !allowed,
  });
  const [upload, { isLoading: uploading }] = useUploadPlantImportMutation();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const send = async () => {
    if (!file) {
      setFileError('Choose a file to import.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    const result = await upload(form);
    if ('data' in result && result.data)
      router.push(`/plant/import/${result.data.id}`);
    else if ('error' in result) {
      const failure = result.error as ApiError;
      setFileError(
        failure.fieldErrors?.find((item) => item.field === 'file')?.message ??
          null,
      );
    }
  };

  return (
    <Stack gap="lg">
      <AppPageHeader
        crumbs={[{ label: 'Plant', href: '/plant' }, { label: 'Import' }]}
        title="Import plant"
        description="Add new plant from a spreadsheet. Nothing is created until you have checked the rows."
      />
      {!allowed ? (
        <EmptyState
          title="No access"
          message="You do not have permission to import plant."
        />
      ) : (
        <>
          <Card withBorder radius="md" padding="lg">
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Excel or CSV, up to {PLANT_IMPORT_MAX_ROWS} rows and 5 MB. The
                template lists the columns and the values each one accepts.
                Importing adds new plant only; it never changes existing plant.
              </Text>
              <FileInput
                label="File"
                placeholder="Choose an .xlsx or .csv file"
                accept=".xlsx,.csv"
                value={file}
                error={fileError}
                onChange={(next) => {
                  setFile(next);
                  setFileError(null);
                }}
              />
              <Group gap="sm">
                <Button
                  leftSection={<IconUpload size={16} />}
                  loading={uploading}
                  onClick={() => void send()}
                >
                  Upload and check
                </Button>
                <Button
                  variant="default"
                  leftSection={<IconDownload size={16} />}
                  onClick={() =>
                    void downloadFile(
                      '/plant-imports/template',
                      'plant-import-template.xlsx',
                    )
                  }
                >
                  Download template
                </Button>
              </Group>
            </Stack>
          </Card>
          {error ? (
            <ErrorAlert error={error as ApiError} />
          ) : (
            <TableCard>
              <DataTable
                columns={COLUMNS}
                rows={data ?? []}
                rowKey={(row) => row.id}
                loading={isLoading}
                onRowClick={(row) => router.push(`/plant/import/${row.id}`)}
                empty={
                  <EmptyState
                    title="No imports yet"
                    message="Files you upload are kept here with the outcome of each row."
                  />
                }
              />
            </TableCard>
          )}
        </>
      )}
    </Stack>
  );
}
