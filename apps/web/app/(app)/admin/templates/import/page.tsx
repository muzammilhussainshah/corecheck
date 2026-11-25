'use client';

import { Button, Card, FileInput, Group, Stack, Text } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  TEMPLATE_IMPORT_MAX_ROWS,
  type TemplateImportSummary,
} from '@corecheck/shared';
import {
  type Column,
  DataTable,
  EmptyState,
  ErrorAlert,
  formatDateTime,
  TableCard,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../../../components/AppPageHeader';
import {
  useTemplateImportsQuery,
  useUploadTemplateImportMutation,
} from '../../../../../lib/api';
import { downloadFile } from '../../../../../lib/download';
import { useSession } from '../../../../../lib/session';

/** Upload a check template file, and every earlier import (FRD 19.4). */
export default function TemplateImportPage() {
  const router = useRouter();
  const { can, me } = useSession();
  const tz = me?.organisation.timeZone;
  const allowed = can('templates.manage') && can('templates.configure_questions');
  const { data, isLoading, error } = useTemplateImportsQuery(undefined, {
    skip: !allowed,
  });
  const [upload, { isLoading: uploading }] = useUploadTemplateImportMutation();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const columns: Column<TemplateImportSummary>[] = [
    { key: 'file', header: 'File', render: (row) => row.fileName },
    { key: 'by', header: 'Imported by', render: (row) => row.createdBy },
    { key: 'when', header: 'When', render: (row) => formatDateTime(row.createdAt, tz) },
    { key: 'templates', header: 'Templates', align: 'right', render: (row) => row.templates },
    { key: 'imported', header: 'Created as Draft', align: 'right', render: (row) => row.imported },
    {
      key: 'waiting',
      header: 'Rows to correct',
      align: 'right',
      render: (row) => row.counts.invalid,
    },
  ];

  const send = async () => {
    if (!file) return setFileError('Choose a file to import.');
    const form = new FormData();
    form.append('file', file);
    const result = await upload(form);
    if ('data' in result && result.data)
      router.push(`/admin/templates/import/${result.data.id}`);
    else if ('error' in result) {
      const failure = result.error as ApiError;
      setFileError(
        failure.fieldErrors?.find((item) => item.field === 'file')?.message ??
          failure.message,
      );
    }
  };

  return (
    <Stack gap="lg">
      <AppPageHeader
        crumbs={[
          { label: 'Templates', href: '/admin/templates' },
          { label: 'Import' },
        ]}
        title="Import check templates"
        description="One row per question; rows with the same template name make one template. Templates are created as Drafts for you to review and publish."
      />
      {!allowed ? (
        <EmptyState
          title="No access"
          message="Only those who manage templates and their questions can import them."
        />
      ) : (
        <>
          <Card withBorder radius="md" padding="lg">
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Excel or CSV, up to {TEMPLATE_IMPORT_MAX_ROWS} rows and 5 MB.
                The template explains every column and lists your plant types,
                disciplines and meter types. Scheduled or completed checks are
                not imported.
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
                    void downloadFile('/template-imports/template', 'template-import.xlsx')
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
                columns={columns}
                rows={data ?? []}
                rowKey={(row) => row.id}
                loading={isLoading}
                onRowClick={(row) => router.push(`/admin/templates/import/${row.id}`)}
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
