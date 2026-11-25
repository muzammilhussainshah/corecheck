'use client';

import { Anchor, Group, Stack, Text } from '@mantine/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type CheckSummary, TEMPLATE_PURPOSE_LABELS } from '@corecheck/shared';
import { type Column, DataTable, formatDate } from '@corecheck/ui';
import { assigneeText, CheckStatusBadge } from './badges';
import type { ReactNode } from 'react';

/** A page of checks, linking to each (LST-005 empty state given by caller). */
export function ChecksTable({
  rows,
  loading,
  empty,
  showPlant = true,
  timeZone,
  pagination,
}: {
  rows: CheckSummary[] | undefined;
  loading: boolean;
  empty: ReactNode;
  showPlant?: boolean;
  timeZone?: string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
    onPageSizeChange?: (pageSize: number) => void;
  };
}) {
  const router = useRouter();
  const columns: Column<CheckSummary>[] = [
    {
      key: 'check',
      header: 'Check',
      render: (check) => (
        <Stack gap={0}>
          <Group gap={6} wrap="nowrap">
            <Text fw={600} size="sm" style={{ whiteSpace: 'nowrap' }}>
              {check.ref}
            </Text>
            <Text size="sm" lineClamp={1}>
              {check.template.name}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            {TEMPLATE_PURPOSE_LABELS[check.template.purpose]}
            {check.schedule ? ` · ${check.schedule.name}` : ''}
            {check.defect ? ` · verifies ${check.defect.ref}` : ''}
          </Text>
        </Stack>
      ),
    },
    ...(showPlant
      ? [
          {
            key: 'plant',
            header: 'Plant',
            width: 220,
            render: (check: CheckSummary) => (
              <Stack gap={0}>
                <Anchor
                  component={Link}
                  href={`/plant/${check.plant.id}`}
                  size="sm"
                  fw={600}
                  onClick={(event) => event.stopPropagation()}
                >
                  {check.plant.assetId}
                </Anchor>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {check.plant.name} · {check.plant.site.name}
                </Text>
              </Stack>
            ),
          },
        ]
      : []),
    {
      key: 'due',
      header: 'Due',
      width: 120,
      render: (check) => (
        <Text size="sm" c={check.overdue ? 'red.7' : undefined} fw={check.overdue ? 600 : undefined}>
          {check.dueOn ? formatDate(check.dueOn, timeZone) : '—'}
        </Text>
      ),
    },
    {
      key: 'assignee',
      header: 'Assigned to',
      width: 200,
      render: (check) => (
        <Text size="sm" lineClamp={2}>
          {assigneeText(check.assignee)}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 200,
      render: (check) => <CheckStatusBadge status={check.displayStatus} />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(check) => check.id}
      loading={loading}
      onRowClick={(check) => router.push(`/checks/${check.id}`)}
      pagination={pagination}
      empty={empty}
    />
  );
}
