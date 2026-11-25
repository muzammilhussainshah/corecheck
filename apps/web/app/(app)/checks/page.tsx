'use client';

import { Button, Group, SegmentedControl, Select, SimpleGrid } from '@mantine/core';
import { useDisclosure, useDebouncedValue } from '@mantine/hooks';
import { IconDeviceMobile, IconDownload, IconPlus, IconX } from '@tabler/icons-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  CHECK_STATUS_LABELS,
  CHECK_STATUSES,
  CHECK_VIEWS,
  type CheckView,
} from '@corecheck/shared';
import {
  DEFAULT_PAGE_SIZE,
  EmptyState,
  ErrorAlert,
  SearchInput,
  StatCard,
  TableCard,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../components/AppPageHeader';
import { ChecksTable } from '../../../components/checks/ChecksTable';
import { NewCheckModal } from '../../../components/checks/NewCheckModal';
import {
  useChecksQuery,
  useSitesQuery,
  useTemplatesQuery,
  useWorkSummaryQuery,
} from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { downloadFile } from '../../../lib/download';
import { useOpenFromQuery } from '../../../lib/useOpenFromQuery';

const VIEWS: Array<{ value: CheckView; label: string }> = [
  { value: 'mine', label: 'My work' },
  { value: 'due', label: 'Due' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'review', label: 'Awaiting review' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

const EMPTY: Record<CheckView, string> = {
  mine: 'Nothing is assigned to you or your teams and disciplines right now.',
  due: 'No checks are due.',
  overdue: 'No checks are overdue.',
  upcoming: 'No checks are scheduled ahead.',
  review: 'No checks are waiting for review.',
  completed: 'No completed checks yet.',
  all: 'No checks yet.',
};

/** Checks (FRD 12) within the user's sites, by what needs doing. */
export default function ChecksPage() {
  const { me, can } = useSession();
  const params = useSearchParams();
  const requested = params.get('view') as CheckView | null;
  // Filters a dashboard figure opened this list with (DSH-AC-01); shown as
  // one chip the user can clear without going back (DSH-AC-02 wording).
  const [linked, setLinked] = useState(() => ({
    dueFrom: params.get('dueFrom') ?? undefined,
    dueTo: params.get('dueTo') ?? undefined,
    submittedFrom: params.get('submittedFrom') ?? undefined,
    failed: params.get('failed') === 'true' ? ('true' as const) : undefined,
    withDefects:
      params.get('withDefects') === 'true' ? ('true' as const) : undefined,
    label: params.get('label') ?? undefined,
  }));
  const hasLinked = !!(
    linked.dueFrom ||
    linked.dueTo ||
    linked.submittedFrom ||
    linked.failed ||
    linked.withDefects
  );
  const [view, setView] = useState<CheckView>(
    requested && CHECK_VIEWS.includes(requested) ? requested : 'mine',
  );
  const [search, setSearch] = useState('');
  const [term] = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [creating, { open, close }] = useDisclosure();
  useOpenFromQuery(open);
  // Combinable filters, each clearable on its own (LST-002, LST-003).
  const [siteId, setSiteId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const { data: sites } = useSitesQuery();
  const { data: templates } = useTemplatesQuery();
  const { data: summary } = useWorkSummaryQuery();
  const { data, isFetching, error } = useChecksQuery({
    view,
    search: term || undefined,
    siteId: siteId ?? undefined,
    templateId: templateId ?? undefined,
    status: (status as never) ?? undefined,
    dueFrom: linked.dueFrom,
    dueTo: linked.dueTo,
    submittedFrom: linked.submittedFrom,
    failed: linked.failed,
    withDefects: linked.withDefects,
    page,
    pageSize,
  });
  const filtered = !!(siteId || templateId || status || term || hasLinked);
  const clearLinked = () => {
    setLinked({
      dueFrom: undefined,
      dueTo: undefined,
      submittedFrom: undefined,
      failed: undefined,
      withDefects: undefined,
      label: undefined,
    });
    setPage(1);
  };
  const choose = (next: CheckView) => {
    setView(next);
    setPage(1);
  };
  return (
    <>
      <AppPageHeader
        title="Checks"
        description="Operational, technical and maintenance checks at your sites, and Defect verifications."
        actions={
          <>
            {can('plant.view') && (
              <Button
                variant="subtle"
                leftSection={<IconDeviceMobile size={16} />}
                component={Link}
                href="/checks/mobile-sync"
              >
                Mobile sync demo
              </Button>
            )}
            {can('reports.export') && (
              <Button
                variant="default"
                leftSection={<IconDownload size={16} />}
                onClick={() => {
                  // The list as shown, with the same filters (LST-004).
                  const query = new URLSearchParams(
                    Object.entries({
                      view,
                      search: term || undefined,
                      siteId: siteId ?? undefined,
                      templateId: templateId ?? undefined,
                      status: status ?? undefined,
                      dueFrom: linked.dueFrom,
                      dueTo: linked.dueTo,
                      submittedFrom: linked.submittedFrom,
                      failed: linked.failed,
                      withDefects: linked.withDefects,
                    }).filter((entry): entry is [string, string] => !!entry[1]),
                  );
                  void downloadFile(`/checks/export?${query.toString()}`, 'checks.csv');
                }}
              >
                Export CSV
              </Button>
            )}
            {can('schedules.assign') && (
              <Button leftSection={<IconPlus size={16} />} onClick={open}>
                Assign check
              </Button>
            )}
          </>
        }
      />
      {summary && (
        <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
          <StatCard label="My work" value={summary.checks.mine} selected={view === 'mine'} onClick={() => choose('mine')} />
          <StatCard label="Due" value={summary.checks.due} selected={view === 'due'} onClick={() => choose('due')} />
          <StatCard label="Overdue" value={summary.checks.overdue} selected={view === 'overdue'} onClick={() => choose('overdue')} />
          <StatCard
            label="Awaiting review"
            value={summary.checks.awaitingReview}
            selected={view === 'review'}
            onClick={() => choose('review')}
          />
        </SimpleGrid>
      )}
      <TableCard
        toolbar={
          <Group justify="space-between" w="100%" wrap="wrap">
            <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search checks or plant" />
            <SegmentedControl
              size="xs"
              data={VIEWS}
              value={view}
              onChange={(value) => choose(value as CheckView)}
            />
            <Group gap="sm" w="100%">
              <Select
                aria-label="Site"
                placeholder="All sites"
                clearable
                w={190}
                data={(sites ?? []).map((site) => ({ value: site.id, label: site.name }))}
                value={siteId}
                onChange={(value) => { setSiteId(value); setPage(1); }}
              />
              <Select
                aria-label="Template"
                placeholder="All templates"
                clearable
                searchable
                w={230}
                data={(templates ?? [])
                  .filter((item) => item.purpose !== 'reception')
                  .map((item) => ({ value: item.id, label: item.name }))}
                value={templateId}
                onChange={(value) => { setTemplateId(value); setPage(1); }}
              />
              <Select
                aria-label="Status"
                placeholder="Any status"
                clearable
                w={210}
                data={[...CHECK_STATUSES, 'overdue' as const].map((value) => ({
                  value,
                  label: CHECK_STATUS_LABELS[value],
                }))}
                value={status}
                onChange={(value) => { setStatus(value); setPage(1); }}
              />
              {hasLinked && (
                <Button
                  variant="light"
                  size="xs"
                  rightSection={<IconX size={12} />}
                  onClick={clearLinked}
                  aria-label={`Clear filter: ${linked.label ?? 'from the dashboard'}`}
                >
                  {linked.label ?? 'From the dashboard'}
                </Button>
              )}
              {filtered && (
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => {
                    setSiteId(null);
                    setTemplateId(null);
                    setStatus(null);
                    setSearch('');
                    clearLinked();
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              )}
            </Group>
          </Group>
        }
      >
        {error ? (
          <ErrorAlert error={error as ApiError} />
        ) : (
          <ChecksTable
            rows={data?.items}
            loading={isFetching}
            timeZone={me?.organisation.timeZone}
            empty={
              <EmptyState
                title="No checks"
                message={filtered ? 'Nothing matches these filters. Clear them to see more.' : EMPTY[view]}
              />
            }
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
          />
        )}
      </TableCard>
      {creating && <NewCheckModal opened onClose={close} />}
    </>
  );
}
