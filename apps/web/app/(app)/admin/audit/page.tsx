'use client';

import {
  Badge,
  Button,
  Code,
  Group,
  Modal,
  Select,
  Stack,
  Text,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { IconCalendar } from '@tabler/icons-react';
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
import { AppPageHeader } from '../../../../components/AppPageHeader';
import { useAuditEventsQuery } from '../../../../lib/api';
import { useSession } from '../../../../lib/session';

interface AuditFilters {
  category: string | null;
  from: string;
  to: string;
}
const NO_FILTERS: AuditFilters = { category: null, from: '', to: '' };
const CUSTOMER_CATEGORIES = AUDIT_CATEGORIES.filter(
  (c) => !['organisation', 'staff'].includes(c.key),
);

/** The organisation's security history: sign-ins, PINs, users, roles and structure (SEC-004, ROL-006). */
export default function AuditPage() {
  const { me } = useSession();
  const tz = me?.organisation.timeZone;
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [open, setOpen] = useState<AuditEvent | null>(null);

  const { data, isFetching, error } = useAuditEventsQuery({
    page,
    pageSize,
    category: category ?? undefined,
    search: debounced || undefined,
    from: from || undefined,
    to: to || undefined,
  });
  const [draft, setDraft] = useState<AuditFilters>(NO_FILTERS);
  const [panelOpen, panel] = useDisclosure();
  const applied = [category, from, to].filter(Boolean).length;
  const filtered = !!search || applied > 0;
  const applyFilters = (next: AuditFilters) => {
    setCategory(next.category);
    setFrom(next.from);
    setTo(next.to);
    setDraft(next);
    setPage(1);
  };
  const reset = () => {
    setSearch('');
    applyFilters(NO_FILTERS);
  };

  const columns: Column<AuditEvent>[] = [
    {
      key: 'when',
      header: 'When',
      width: 170,
      render: (event) => (
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
          {formatDateTime(event.occurredAt, tz)}
        </Text>
      ),
    },
    {
      key: 'who',
      header: 'Who',
      width: 210,
      render: (event) => (
        <Group gap={6} wrap="nowrap">
          <Text size="sm">{event.actorName ?? 'System'}</Text>
          {event.actorType === 'staff' && (
            <Badge size="xs" variant="outline">
              CoreCheck
            </Badge>
          )}
        </Group>
      ),
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
        title="Security audit"
        description={`Sign-ins, PIN changes, user, role and structure changes. Times are in ${tz ?? 'your organisation’s time zone'}. Entries cannot be edited or deleted.`}
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
              label="Search audit history"
            />
            <FilterButton
              count={applied}
              onOpen={() => {
                setDraft({ category, from, to });
                panel.open();
              }}
              onClear={() => applyFilters(NO_FILTERS)}
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
            empty={
              <EmptyState
                title="No matching activity"
                message={filtered ? 'Try widening the filters.' : undefined}
                action={
                  filtered && (
                    <Button variant="light" onClick={reset}>
                      Clear filters
                    </Button>
                  )
                }
              />
            }
          />
        )}
      </TableCard>

      <FilterPanel
        opened={panelOpen}
        onClose={panel.close}
        onApply={() => {
          applyFilters(draft);
          panel.close();
        }}
        onClear={() => {
          applyFilters(NO_FILTERS);
          panel.close();
        }}
        sections={[
          {
            key: 'category',
            label: 'Activity',
            count: draft.category ? 1 : 0,
            content: (
              <Select
                placeholder="All activity"
                data={CUSTOMER_CATEGORIES.map((c) => ({
                  value: c.key,
                  label: c.label,
                }))}
                value={draft.category}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, category: value }))
                }
                clearable
                aria-label="Filter by activity"
              />
            ),
          },
          {
            key: 'dates',
            label: 'Date range',
            count: (draft.from ? 1 : 0) + (draft.to ? 1 : 0),
            content: (
              <>
                <DateInput
                  label="From"
                  placeholder="Any date"
                  valueFormat="D MMM YYYY"
                  leftSection={<IconCalendar size={16} />}
                  clearable
                  maxDate={draft.to || undefined}
                  value={draft.from || null}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, from: value ?? '' }))
                  }
                />
                <DateInput
                  label="To"
                  placeholder="Any date"
                  valueFormat="D MMM YYYY"
                  leftSection={<IconCalendar size={16} />}
                  clearable
                  minDate={draft.from || undefined}
                  value={draft.to || null}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, to: value ?? '' }))
                  }
                />
              </>
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
            <Text size="sm" c="dimmed">
              {open.actorName ?? 'System'} ·{' '}
              {formatDateTime(open.occurredAt, tz)}
            </Text>
            {open.before && (
              <>
                <Text size="sm" fw={600}>
                  Before
                </Text>
                <Code block>{JSON.stringify(open.before, null, 2)}</Code>
              </>
            )}
            {open.after && (
              <>
                <Text size="sm" fw={600}>
                  After
                </Text>
                <Code block>{JSON.stringify(open.after, null, 2)}</Code>
              </>
            )}
            {Object.keys(open.metadata).length > 0 && (
              <>
                <Text size="sm" fw={600}>
                  Context
                </Text>
                <Code block>{JSON.stringify(open.metadata, null, 2)}</Code>
              </>
            )}
          </Stack>
        )}
      </Modal>
    </>
  );
}
