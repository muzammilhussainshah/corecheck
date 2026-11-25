'use client';

import { Group, Select, SimpleGrid, Switch } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useState } from 'react';
import {
  type ApiError,
  DEFECT_SEVERITIES,
  DEFECT_SEVERITY_LABELS,
  DEFECT_STATUS_LABELS,
  DEFECT_STATUSES,
  type DefectSeverity,
  type DefectStatus,
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
import { DefectsTable } from '../../../components/checks/DefectsTable';
import { useDefectsQuery, useWorkSummaryQuery } from '../../../lib/api';
import { useSession } from '../../../lib/session';

/** Defects raised from failed answers (FRD 13), within the user's sites. */
export default function DefectsPage() {
  const { me } = useSession();
  const [status, setStatus] = useState<DefectStatus | 'active' | null>('active');
  const [severity, setSeverity] = useState<DefectSeverity | null>(null);
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState('');
  const [term] = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const { data: summary } = useWorkSummaryQuery();
  const { data, isFetching, error } = useDefectsQuery({
    status: status ?? undefined,
    severity: severity ?? undefined,
    assignedToMe: mine,
    search: term || undefined,
    page,
    pageSize,
  });
  const reset = () => setPage(1);
  return (
    <>
      <AppPageHeader
        title="Defects"
        description="Raised only by failed check or reception answers whose question has a defect trigger. Closing a Defect does not return plant to service."
      />
      {summary && (
        <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
          <StatCard label="Open" value={summary.defects.open} selected={status === 'open'} onClick={() => { setStatus('open'); reset(); }} />
          <StatCard label="In Progress" value={summary.defects.inProgress} selected={status === 'in_progress'} onClick={() => { setStatus('in_progress'); reset(); }} />
          <StatCard
            label="Critical"
            value={summary.defects.critical}
            selected={severity === 'critical'}
            onClick={() => { setSeverity(severity === 'critical' ? null : 'critical'); setStatus('active'); reset(); }}
          />
          <StatCard label="Assigned to me" value={summary.defects.assignedToMe} selected={mine} onClick={() => { setMine(!mine); reset(); }} />
        </SimpleGrid>
      )}
      <TableCard
        toolbar={
          <Group justify="space-between" w="100%" wrap="wrap">
            <SearchInput value={search} onChange={(value) => { setSearch(value); reset(); }} placeholder="Search Defects or plant" />
            <Group gap="sm">
              <Select
                aria-label="Status"
                w={170}
                clearable
                placeholder="Any status"
                data={[
                  { value: 'active', label: 'Not closed' },
                  ...DEFECT_STATUSES.map((value) => ({ value, label: DEFECT_STATUS_LABELS[value] })),
                ]}
                value={status}
                onChange={(value) => { setStatus(value as DefectStatus | 'active' | null); reset(); }}
              />
              <Select
                aria-label="Severity"
                w={150}
                clearable
                placeholder="Any severity"
                data={DEFECT_SEVERITIES.map((value) => ({ value, label: DEFECT_SEVERITY_LABELS[value] }))}
                value={severity}
                onChange={(value) => { setSeverity(value as DefectSeverity | null); reset(); }}
              />
              <Switch label="Assigned to me" checked={mine} onChange={(event) => { setMine(event.currentTarget.checked); reset(); }} />
            </Group>
          </Group>
        }
      >
        {error ? (
          <ErrorAlert error={error as ApiError} />
        ) : (
          <DefectsTable
            rows={data?.items}
            loading={isFetching}
            timeZone={me?.organisation.timeZone}
            empty={<EmptyState title="No Defects" message="Nothing matches these filters." />}
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
    </>
  );
}
