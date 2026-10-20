'use client';

import {
  Badge,
  Button,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import {
  IconArchive,
  IconBuilding,
  IconCircleCheck,
  IconPlayerPause,
  IconPlus,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  ORGANISATION_STATUS_LABELS,
  ORGANISATION_STATUSES,
  type OrganisationStatus,
  type OrganisationSummary,
} from '@corecheck/shared';
import {
  type Column,
  DataTable,
  EmptyState,
  ErrorAlert,
  FilterButton,
  FilterPanel,
  formatDate,
  OrganisationStatusBadge,
  SearchInput,
  type SortState,
  StatCard,
  TableCard,
  DEFAULT_PAGE_SIZE,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../components/AppPageHeader';
import { useMeQuery, useOrganisationsQuery } from '../../../lib/api';

/** Totals for the status cards. */
const useOrganisationCount = (status?: OrganisationStatus) =>
  useOrganisationsQuery({ page: 1, pageSize: 1, status }).data?.total;

export default function OrganisationsPage() {
  const router = useRouter();
  const { data: me } = useMeQuery();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ field: 'name', order: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const { data, isFetching, error } = useOrganisationsQuery({
    page,
    pageSize,
    search: debounced || undefined,
    status: (status as OrganisationStatus | null) ?? undefined,
    sort: sort.field as 'name',
    order: sort.order,
  });
  const canProvision = me?.staffRole === 'owner' || me?.staffRole === 'admin';
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [panelOpen, panel] = useDisclosure();
  const counts = {
    all: useOrganisationCount(),
    active: useOrganisationCount('active'),
    suspended: useOrganisationCount('suspended'),
    archived: useOrganisationCount('archived'),
  };
  const cards: Array<{
    label: string;
    value: number | undefined;
    status: OrganisationStatus | null;
    icon: typeof IconBuilding;
  }> = [
    {
      label: 'Total Organisations',
      value: counts.all,
      status: null,
      icon: IconBuilding,
    },
    {
      label: 'Active',
      value: counts.active,
      status: 'active',
      icon: IconCircleCheck,
    },
    {
      label: 'Suspended',
      value: counts.suspended,
      status: 'suspended',
      icon: IconPlayerPause,
    },
    {
      label: 'Archived',
      value: counts.archived,
      status: 'archived',
      icon: IconArchive,
    },
  ];

  const columns: Column<OrganisationSummary>[] = [
    {
      key: 'name',
      header: 'Organisation',
      sortField: 'name',
      render: (org) => (
        <Stack gap={0}>
          <Text fw={600} size="sm">
            {org.name}
          </Text>
          <Text size="xs" c="dimmed">
            {org.industry} · {org.country}
          </Text>
        </Stack>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortField: 'status',
      width: 160,
      render: (org) => <OrganisationStatusBadge status={org.status} />,
    },
    {
      key: 'seats',
      header: 'Seats',
      align: 'right',
      width: 110,
      render: (org) => (
        <Text size="sm" c={org.seatsUsed >= org.seatLimit ? 'red' : undefined}>
          {org.seatsUsed} / {org.seatLimit}
        </Text>
      ),
    },
    {
      key: 'expiresOn',
      header: 'Expires',
      sortField: 'expiresOn',
      width: 260,
      render: (org) => (
        <Group gap={6} wrap="nowrap">
          <Text size="sm">{formatDate(org.expiresOn)}</Text>
          {org.expired && (
            <Badge color="orange" variant="light" size="sm">
              Expired · read-only
            </Badge>
          )}
        </Group>
      ),
    },
  ];

  return (
    <>
      <AppPageHeader
        title="Organisations"
        description="Customer organisations, their seats and account dates. Staff cannot open customer records."
        actions={
          canProvision && (
            <Button
              component={Link}
              href="/organisations/new"
              leftSection={<IconPlus size={16} />}
            >
              New organisation
            </Button>
          )
        }
      />
      <SimpleGrid cols={{ base: 2, xl: 4 }} mb="lg" spacing="sm">
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value ?? '—'}
            icon={<card.icon size={20} />}
            selected={status === card.status}
            onClick={() => {
              setStatus(card.status);
              setPage(1);
            }}
          />
        ))}
      </SimpleGrid>
      <TableCard
        toolbar={
          <>
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search name, contact or industry"
              label="Search organisations"
            />
            <FilterButton
              count={status ? 1 : 0}
              onOpen={() => {
                setDraftStatus(status);
                panel.open();
              }}
              onClear={() => {
                setStatus(null);
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
            rowKey={(org) => org.id}
            loading={isFetching}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            onRowClick={(org) => router.push(`/organisations/${org.id}`)}
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
                title="No organisations found"
                message={
                  search || status
                    ? 'Try another search or filter.'
                    : 'Create the first customer organisation.'
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
          setStatus(draftStatus);
          setPage(1);
          panel.close();
        }}
        onClear={() => {
          setStatus(null);
          setDraftStatus(null);
          setPage(1);
          panel.close();
        }}
        sections={[
          {
            key: 'status',
            label: 'Status',
            count: draftStatus ? 1 : 0,
            content: (
              <Select
                placeholder="Any status"
                data={ORGANISATION_STATUSES.map((value) => ({
                  value,
                  label: ORGANISATION_STATUS_LABELS[value],
                }))}
                value={draftStatus}
                onChange={setDraftStatus}
                clearable
                aria-label="Filter by status"
              />
            ),
          },
        ]}
      />
    </>
  );
}
