'use client';

import { Anchor, Button, Card, Group, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ApiError, CheckView, PlantDetail } from '@corecheck/shared';
import { DEFAULT_PAGE_SIZE, EmptyState, ErrorAlert, formatDate } from '@corecheck/ui';
import { ChecksTable } from '../checks/ChecksTable';
import { NewCheckModal } from '../checks/NewCheckModal';
import { assigneeText, CheckStatusBadge, ScheduleStateBadge } from '../checks/badges';
import { useChecksQuery, useSchedulesQuery } from '../../lib/api';
import { useSession } from '../../lib/session';

/** The plant's checks and schedules (CHK-002, FRD 11). */
export function PlantChecksTab({ plant }: { plant: PlantDetail }) {
  const { me, can } = useSession();
  const tz = me?.organisation.timeZone;
  const [view, setView] = useState<CheckView>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [assigning, setAssigning] = useState(false);
  const { data, isFetching, error } = useChecksQuery({ view, plantId: plant.id, page, pageSize });
  const { data: schedules } = useSchedulesQuery({ plantId: plant.id }, { skip: !can('schedules.view') });
  const canAssign =
    can('schedules.assign') && !plant.archivedAt && ['approved', 'restricted'].includes(plant.status);
  return (
    <Stack>
      {schedules && schedules.length > 0 && (
        <Card withBorder>
          <Title order={4} mb="sm">
            Schedules
          </Title>
          <Stack gap={8}>
            {schedules.map((schedule) => (
              <Group key={schedule.id} gap="sm" wrap="wrap">
                <Text size="sm" fw={600}>
                  {schedule.name}
                </Text>
                <Text size="sm" c="dimmed">
                  {schedule.template.name} · {schedule.recurrence} · {assigneeText(schedule.assignee)}
                </Text>
                <ScheduleStateBadge state={schedule.state} />
                {schedule.openCheck ? (
                  <Group gap={4}>
                    <Anchor component={Link} href={`/checks/${schedule.openCheck.id}`} size="sm">
                      {schedule.openCheck.ref}
                    </Anchor>
                    <CheckStatusBadge status={schedule.openCheck.status} />
                  </Group>
                ) : (
                  schedule.state === 'active' && (
                    <Text size="sm">Next due {formatDate(schedule.nextDueOn, tz)}</Text>
                  )
                )}
              </Group>
            ))}
          </Stack>
        </Card>
      )}
      <Card withBorder p={0}>
        <Group justify="space-between" p="md" wrap="wrap">
          <SegmentedControl
            size="xs"
            data={[
              { value: 'all', label: 'All' },
              { value: 'due', label: 'Due' },
              { value: 'overdue', label: 'Overdue' },
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'review', label: 'Awaiting review' },
            ]}
            value={view}
            onChange={(value) => {
              setView(value as CheckView);
              setPage(1);
            }}
          />
          {canAssign && (
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setAssigning(true)}>
              Assign check
            </Button>
          )}
        </Group>
        {error ? (
          <ErrorAlert error={error as ApiError} />
        ) : (
          <ChecksTable
            rows={data?.items}
            loading={isFetching}
            showPlant={false}
            timeZone={tz}
            empty={<EmptyState title="No checks" message="Checks for this plant appear here once assigned or scheduled." />}
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
      </Card>
      {assigning && (
        <NewCheckModal
          opened
          onClose={() => setAssigning(false)}
          plant={{ id: plant.id, label: `${plant.assetId} ${plant.name}` }}
        />
      )}
    </Stack>
  );
}
