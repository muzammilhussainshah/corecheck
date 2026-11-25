'use client';

import { Button, Group, SegmentedControl, SimpleGrid } from '@mantine/core';
import { useDisclosure, useDebouncedValue } from '@mantine/hooks';
import { IconDeviceMobile, IconPlus } from '@tabler/icons-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { type ApiError, CHECK_VIEWS, type CheckView } from '@corecheck/shared';
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
import { useChecksQuery, useWorkSummaryQuery } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useOpenFromQuery } from '../../../lib/useOpenFromQuery';

const VIEWS: Array<{ value: CheckView; label: string }> = [
  { value: 'mine', label: 'My work' },
  { value: 'due', label: 'Due' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'review', label: 'Awaiting review' },
  { value: 'all', label: 'All' },
];

const EMPTY: Record<CheckView, string> = {
  mine: 'Nothing is assigned to you or your teams and disciplines right now.',
  due: 'No checks are due.',
  overdue: 'No checks are overdue.',
  upcoming: 'No checks are scheduled ahead.',
  review: 'No checks are waiting for review.',
  all: 'No checks yet.',
};

/** Checks (FRD 12) within the user's sites, by what needs doing. */
export default function ChecksPage() {
  const { me, can } = useSession();
  const requested = useSearchParams().get('view') as CheckView | null;
  const [view, setView] = useState<CheckView>(
    requested && CHECK_VIEWS.includes(requested) ? requested : 'mine',
  );
  const [search, setSearch] = useState('');
  const [term] = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [creating, { open, close }] = useDisclosure();
  useOpenFromQuery(open);
  const { data: summary } = useWorkSummaryQuery();
  const { data, isFetching, error } = useChecksQuery({
    view,
    search: term || undefined,
    page,
    pageSize,
  });
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
            empty={<EmptyState title="No checks" message={EMPTY[view]} />}
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
