'use client';

import { MultiSelect, SimpleGrid, Stack, Text } from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconClockHour4,
  IconFileCertificate,
  IconHourglass,
  IconX,
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  DOCUMENT_STATE_LABELS,
  DOCUMENT_STATES,
  type DocumentRegisterRow,
  type ListDocumentsQuery,
} from '@corecheck/shared';
import {
  type Column,
  COLORS,
  DataTable,
  DEFAULT_PAGE_SIZE,
  EmptyState,
  ErrorAlert,
  FilterButton,
  FilterPanel,
  formatDate,
  SearchInput,
  type SortState,
  StatCard,
  TableCard,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../components/AppPageHeader';
import { DocumentStateBadge } from '../../../components/plant/DocumentBadges';
import { useDocumentsRegisterQuery, useSitesQuery } from '../../../lib/api';
import { useConfigList } from '../../../lib/config';
import { useSession } from '../../../lib/session';

type State = NonNullable<ListDocumentsQuery['state']>;

interface Filters {
  state: State | null;
  documentTypeId: string | null;
  siteId: string | null;
}
const NO_FILTERS: Filters = { state: null, documentTypeId: null, siteId: null };

const useStateCount = (state?: State) =>
  useDocumentsRegisterQuery({ page: 1, pageSize: 1, state }).data?.total;

const named = (items: { id: string; name: string }[] | undefined) =>
  (items ?? []).map((item) => ({ value: item.id, label: item.name }));

/** Every document at the user's sites, by status and expiry (FRD 9). */
export default function DocumentsPage() {
  const router = useRouter();
  const { me } = useSession();
  const tz = me?.organisation.timeZone;
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [panelOpen, panel] = useDisclosure();
  const [sort, setSort] = useState<SortState>({
    field: 'expiresOn',
    order: 'asc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const { data, isFetching, error } = useDocumentsRegisterQuery({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    state: filters.state ?? undefined,
    documentTypeId: filters.documentTypeId ?? undefined,
    siteId: filters.siteId ?? undefined,
    sort: sort.field as ListDocumentsQuery['sort'],
    order: sort.order,
  });
  const counts = {
    expired: useStateCount('expired'),
    approaching: useStateCount('approaching_expiry'),
    awaiting: useStateCount('awaiting_verification'),
    rejected: useStateCount('rejected'),
  };
  const types = useConfigList('document-types', { includeArchived: true });
  const sites = useSitesQuery();

  const applied = Object.values(filters).filter(Boolean).length;
  const filtered = !!search || applied > 0;
  const apply = (next: Filters) => {
    setFilters(next);
    setDraft(next);
    setPage(1);
  };

  const single = (
    key: keyof Filters,
    options: { value: string; label: string }[],
    label: string,
  ) => (
    <MultiSelect
      data={options}
      value={draft[key] ? [draft[key]!] : []}
      onChange={(values) =>
        setDraft((current) => ({ ...current, [key]: values.at(-1) ?? null }))
      }
      placeholder="Any"
      searchable
      clearable
      aria-label={`Filter by ${label}`}
    />
  );

  const columns: Column<DocumentRegisterRow>[] = [
    {
      key: 'plant',
      header: 'Plant',
      sortField: 'assetId',
      render: (row) => (
        <Stack gap={0}>
          <Text fw={600} size="sm" c={COLORS.title}>
            {row.plant.assetId}
          </Text>
          <Text size="xs" c={COLORS.muted}>
            {row.plant.name}
          </Text>
        </Stack>
      ),
    },
    {
      key: 'type',
      header: 'Document',
      render: (row) => (
        <Stack gap={0}>
          <Text size="sm" fw={500}>
            {row.documentType.name}
          </Text>
          {row.reference && (
            <Text size="xs" c={COLORS.muted}>
              Ref. {row.reference}
            </Text>
          )}
        </Stack>
      ),
    },
    {
      key: 'site',
      header: 'Site',
      render: (row) => <Text size="sm">{row.plant.site.name}</Text>,
    },
    {
      key: 'expiresOn',
      header: 'Expires',
      sortField: 'expiresOn',
      width: 140,
      render: (row) => (
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
          {row.expiresOn ? formatDate(row.expiresOn, tz) : 'Does not expire'}
        </Text>
      ),
    },
    {
      key: 'uploadedAt',
      header: 'Uploaded',
      sortField: 'uploadedAt',
      width: 140,
      render: (row) => (
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
          {formatDate(row.uploadedAt, tz)}
        </Text>
      ),
    },
    {
      key: 'state',
      header: 'Status',
      width: 190,
      render: (row) => <DocumentStateBadge state={row.state} />,
    },
  ];

  const cards: Array<{
    label: string;
    value: number | undefined;
    state: State;
    icon: typeof IconFileCertificate;
  }> = [
    {
      label: DOCUMENT_STATE_LABELS.expired,
      value: counts.expired,
      state: 'expired',
      icon: IconAlertTriangle,
    },
    {
      label: DOCUMENT_STATE_LABELS.approaching_expiry,
      value: counts.approaching,
      state: 'approaching_expiry',
      icon: IconClockHour4,
    },
    {
      label: DOCUMENT_STATE_LABELS.awaiting_verification,
      value: counts.awaiting,
      state: 'awaiting_verification',
      icon: IconHourglass,
    },
    {
      label: DOCUMENT_STATE_LABELS.rejected,
      value: counts.rejected,
      state: 'rejected',
      icon: IconX,
    },
  ];

  return (
    <>
      <AppPageHeader
        title="Documents"
        description="Certificates and records for plant at your sites, with their expiry and verification. Upload them from each plant."
      />
      <SimpleGrid cols={{ base: 2, xl: 4 }} mb="lg" spacing="sm">
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value ?? '—'}
            icon={<card.icon size={20} />}
            selected={filters.state === card.state}
            onClick={() =>
              apply({
                ...filters,
                state: filters.state === card.state ? null : card.state,
              })
            }
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
              placeholder="Search plant or reference"
              label="Search documents"
            />
            <FilterButton
              count={applied}
              onOpen={() => {
                setDraft(filters);
                panel.open();
              }}
              onClear={() => apply(NO_FILTERS)}
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
            rowKey={(row) => row.id}
            loading={isFetching}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            onRowClick={(row) =>
              router.push(`/plant/${row.plant.id}?tab=documents`)
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
            empty={
              <EmptyState
                title={
                  filtered
                    ? 'No documents match these filters'
                    : 'No documents yet'
                }
                message={
                  filtered
                    ? 'Try removing a filter or searching for something else.'
                    : 'Open a plant and upload its certificates under Documents.'
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
          apply(draft);
          panel.close();
        }}
        onClear={() => {
          apply(NO_FILTERS);
          panel.close();
        }}
        sections={[
          {
            key: 'state',
            label: 'Status',
            count: draft.state ? 1 : 0,
            content: single(
              'state',
              DOCUMENT_STATES.filter((state) => state !== 'missing').map(
                (state) => ({
                  value: state,
                  label: DOCUMENT_STATE_LABELS[state],
                }),
              ),
              'status',
            ),
          },
          {
            key: 'type',
            label: 'Document type',
            count: draft.documentTypeId ? 1 : 0,
            content: single('documentTypeId', named(types.data), 'type'),
          },
          {
            key: 'site',
            label: 'Site',
            count: draft.siteId ? 1 : 0,
            content: single('siteId', named(sites.data), 'site'),
          },
        ]}
      />
    </>
  );
}
