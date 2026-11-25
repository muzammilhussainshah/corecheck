'use client';

import { Anchor, Group, Stack, Text } from '@mantine/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { DefectSummary } from '@corecheck/shared';
import { type Column, DataTable, formatDate } from '@corecheck/ui';
import { DefectStatusBadge, SeverityBadge, VerificationBadge } from './badges';

export function DefectsTable({
  rows,
  loading,
  empty,
  showPlant = true,
  timeZone,
  pagination,
}: {
  rows: DefectSummary[] | undefined;
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
  const columns: Column<DefectSummary>[] = [
    {
      key: 'defect',
      header: 'Defect',
      render: (defect) => (
        <Stack gap={0}>
          <Group gap={6} wrap="nowrap">
            <Text fw={600} size="sm" style={{ whiteSpace: 'nowrap' }}>
              {defect.ref}
            </Text>
            <Text size="sm" lineClamp={1}>
              {defect.questionText}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            Raised by {defect.raisedBy} on {formatDate(defect.raisedAt, timeZone)} from{' '}
            {defect.source.kind === 'check' ? defect.source.ref : 'reception'}
            {defect.restrictsPlant ? ' · keeps plant Offline' : ''}
          </Text>
        </Stack>
      ),
    },
    ...(showPlant
      ? [
          {
            key: 'plant',
            header: 'Plant',
            width: 200,
            render: (defect: DefectSummary) => (
              <Stack gap={0}>
                <Anchor
                  component={Link}
                  href={`/plant/${defect.plant.id}?tab=defects`}
                  size="sm"
                  fw={600}
                  onClick={(event) => event.stopPropagation()}
                >
                  {defect.plant.assetId}
                </Anchor>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {defect.plant.name} · {defect.plant.site.name}
                </Text>
              </Stack>
            ),
          },
        ]
      : []),
    {
      key: 'severity',
      header: 'Severity',
      width: 120,
      render: (defect) => <SeverityBadge severity={defect.severity} />,
    },
    {
      key: 'assignee',
      header: 'Assigned to',
      width: 160,
      render: (defect) => <Text size="sm">{defect.assignee?.name ?? 'Unassigned'}</Text>,
    },
    {
      key: 'status',
      header: 'Status',
      width: 260,
      render: (defect) => (
        <Group gap={6}>
          <DefectStatusBadge status={defect.status} />
          {defect.status !== 'closed' && <VerificationBadge state={defect.verification} />}
        </Group>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(defect) => defect.id}
      loading={loading}
      onRowClick={(defect) => router.push(`/defects/${defect.id}`)}
      pagination={pagination}
      empty={empty}
    />
  );
}
