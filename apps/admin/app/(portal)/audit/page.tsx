'use client';

import { Code, Modal, Select, Stack, Text } from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { useState } from 'react';
import {
  type ApiError,
  AUDIT_CATEGORIES,
  type AuditEvent,
  auditActionLabel,
} from '@corecheck/shared';
import {
  type Column,
  DataTable,
  EmptyState,
  ErrorAlert,
  FilterButton,
  FilterPanel,
  formatDateTime,
  SearchInput,
  TableCard,
  DEFAULT_PAGE_SIZE,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../components/AppPageHeader';
import { useAuditEventsQuery } from '../../../lib/api';

/** Internal security and provisioning records (IAD-004). */
export default function PlatformAuditPage() {
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [panelOpen, panel] = useDisclosure();
  const { data, isFetching, error } = useAuditEventsQuery({
    page,
    pageSize,
    category: category ?? undefined,
    search: debounced || undefined,
  });

  const columns: Column<AuditEvent>[] = [
    {
      key: 'when',
      header: 'When',
      width: 170,
      render: (event) => (
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
          {formatDateTime(event.occurredAt)}
        </Text>
      ),
    },
    {
      key: 'who',
      header: 'Who',
      width: 210,
      render: (event) => <Text size="sm">{event.actorName ?? 'System'}</Text>,
    },
    {
      key: 'org',
      header: 'Organisation',
      width: 220,
      render: (event) => <Text size="sm">{event.organisationName ?? '—'}</Text>,
    },
    {
      key: 'what',
      header: 'What',
      width: 210,
      render: (event) => (
        <Text size="sm" fw={600}>
          {auditActionLabel(event.action)}
        </Text>
      ),
    },
    {
      key: 'summary',
      header: 'Details',
      render: (event) => (
        <Text size="sm" lineClamp={2}>
          {event.summary}
        </Text>
      ),
    },
  ];

  return (
    <>
      <AppPageHeader
        title="Audit trail"
        description="Staff sign-ins and every provisioning action. Entries cannot be edited or deleted."
      />
      <TableCard
        toolbar={
          <>
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search details or person"
              label="Search audit trail"
            />
            <FilterButton
              count={category ? 1 : 0}
              onOpen={() => {
                setDraft(category);
                panel.open();
              }}
              onClear={() => {
                setCategory(null);
                setPage(1);
              }}
            />
          </>
        }
      >
        {error ? (
          <ErrorAlert error={error as ApiError} />
        ) : (
          <DataTable
            columns={columns}
            rows={data?.items}
            rowKey={(event) => event.id}
            loading={isFetching}
            onRowClick={setOpen}
            pagination={
              data && {
                page,
                pageSize,
                total: data.total,
                onChange: setPage,
                onPageSizeChange: (size: number) => {
                  setPageSize(size);
                  setPage(1);
                },
              }
            }
            empty={<EmptyState title="No matching activity" />}
          />
        )}
      </TableCard>
      <FilterPanel
        opened={panelOpen}
        onClose={panel.close}
        onApply={() => {
          setCategory(draft);
          setPage(1);
          panel.close();
        }}
        onClear={() => {
          setCategory(null);
          setDraft(null);
          setPage(1);
          panel.close();
        }}
        sections={[
          {
            key: 'category',
            label: 'Activity',
            count: draft ? 1 : 0,
            content: (
              <Select
                placeholder="All activity"
                data={AUDIT_CATEGORIES.map((c) => ({
                  value: c.key,
                  label: c.label,
                }))}
                value={draft}
                onChange={setDraft}
                clearable
                aria-label="Filter by activity"
              />
            ),
          },
        ]}
      />
      <Modal
        opened={!!open}
        onClose={() => setOpen(null)}
        title={open ? auditActionLabel(open.action) : ''}
        size="lg"
      >
        {open && (
          <Stack gap="sm">
            <Text size="sm">{open.summary}</Text>
            {open.before && (
              <Code block>{JSON.stringify(open.before, null, 2)}</Code>
            )}
            {open.after && (
              <Code block>{JSON.stringify(open.after, null, 2)}</Code>
            )}
            <Code block>{JSON.stringify(open.metadata, null, 2)}</Code>
          </Stack>
        )}
      </Modal>
    </>
  );
}
