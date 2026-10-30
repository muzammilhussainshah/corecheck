'use client';

import {
  Button,
  Group,
  Menu,
  MultiSelect,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconBuildingFactory2,
  IconChevronDown,
  IconCircleCheck,
  IconClockHour4,
  IconDownload,
  IconFileImport,
  IconHourglass,
  IconPlus,
  IconQrcode,
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  type ListPlantsQuery,
  PLANT_OWNERSHIP_LABELS,
  PLANT_OWNERSHIPS,
  PLANT_STATUS_LABELS,
  PLANT_COMPLIANCE_LABELS,
  PLANT_COMPLIANCE_STATES,
  PLANT_STATUSES,
  type PlantStatus,
  type PlantSummary,
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
  Pill,
  SearchInput,
  type SortState,
  StatCard,
  TableCard,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../components/AppPageHeader';
import { ComplianceBadge } from '../../../components/plant/DocumentBadges';
import { PlantStatusBadge } from '../../../components/plant/PlantStatusBadge';
import { usePlantsQuery, useSitesQuery } from '../../../lib/api';
import { useConfigList } from '../../../lib/config';
import { downloadFile } from '../../../lib/download';
import { useSession } from '../../../lib/session';

type StatusFilter = PlantStatus | 'archived';

interface Filters {
  status: StatusFilter | null;
  siteId: string | null;
  plantTypeId: string | null;
  categoryId: string | null;
  ownership: string | null;
  companyId: string | null;
  compliance: string | null;
}
const NO_FILTERS: Filters = {
  status: null,
  siteId: null,
  plantTypeId: null,
  categoryId: null,
  ownership: null,
  companyId: null,
  compliance: null,
};

const useStatusCount = (status?: PlantStatus) =>
  usePlantsQuery({ page: 1, pageSize: 1, status }).data?.total;

/** Query string of the current filters, for exports and label sheets. */
const toSearch = (query: Record<string, string | undefined>): string =>
  new URLSearchParams(
    Object.entries(query).filter(
      (entry): entry is [string, string] => !!entry[1],
    ),
  ).toString();

const named = (items: { id: string; name: string }[] | undefined) =>
  (items ?? []).map((item) => ({ value: item.id, label: item.name }));

/** The Plant Register (FRD 7.2). */
export default function PlantRegisterPage() {
  const router = useRouter();
  const { can } = useSession();
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [panelOpen, panel] = useDisclosure();
  const [sort, setSort] = useState<SortState>({
    field: 'assetId',
    order: 'asc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [busy, setBusy] = useState(false);

  const listQuery = {
    search: debouncedSearch || undefined,
    status: filters.status ?? undefined,
    siteId: filters.siteId ?? undefined,
    plantTypeId: filters.plantTypeId ?? undefined,
    categoryId: filters.categoryId ?? undefined,
    ownership: (filters.ownership ?? undefined) as ListPlantsQuery['ownership'],
    companyId: filters.companyId ?? undefined,
    compliance: (filters.compliance ??
      undefined) as ListPlantsQuery['compliance'],
    sort: sort.field as ListPlantsQuery['sort'],
    order: sort.order,
  };
  const { data, isFetching, error } = usePlantsQuery({
    ...listQuery,
    page,
    pageSize,
  });
  const counts = {
    all: useStatusCount(),
    pending: useStatusCount('pending_reception'),
    awaiting: useStatusCount('awaiting_approval'),
    approved: useStatusCount('approved'),
    restricted: useStatusCount('restricted'),
  };
  const sites = useSitesQuery();
  const types = useConfigList('plant-types');
  const categories = useConfigList('plant-categories');
  const companies = useConfigList('plant-companies');

  const applied = Object.values(filters).filter(Boolean).length;
  const filtered = !!search || applied > 0;
  const apply = (next: Filters) => {
    setFilters(next);
    setDraft(next);
    setPage(1);
  };
  const clearAll = () => {
    setSearch('');
    apply(NO_FILTERS);
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

  /** Downloads a file made from the register as it is currently filtered. */
  const download = async (
    path: string,
    extra: Record<string, string>,
    name: string,
  ) => {
    setBusy(true);
    await downloadFile(`${path}?${toSearch({ ...listQuery, ...extra })}`, name);
    setBusy(false);
  };

  const columns: Column<PlantSummary>[] = [
    {
      key: 'assetId',
      header: 'Asset ID',
      sortField: 'assetId',
      width: 150,
      render: (plant) => (
        <Stack gap={0}>
          <Text
            fw={600}
            size="sm"
            c={COLORS.title}
            style={{ whiteSpace: 'nowrap' }}
          >
            {plant.assetId}
          </Text>
          {plant.plantNumber && (
            <Text size="xs" c={COLORS.muted}>
              No. {plant.plantNumber}
            </Text>
          )}
        </Stack>
      ),
    },
    {
      key: 'name',
      header: 'Equipment',
      sortField: 'name',
      render: (plant) => (
        <Stack gap={0}>
          <Text size="sm" fw={500}>
            {plant.name}
          </Text>
          {(plant.make || plant.model) && (
            <Text size="xs" c={COLORS.muted}>
              {[plant.make, plant.model].filter(Boolean).join(' ')}
            </Text>
          )}
        </Stack>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortField: 'type',
      render: (plant) => (
        <Stack gap={0}>
          <Text size="sm">{plant.plantType.name}</Text>
          {plant.category && (
            <Text size="xs" c={COLORS.muted}>
              {plant.category.name}
            </Text>
          )}
        </Stack>
      ),
    },
    {
      key: 'ownership',
      header: 'Ownership',
      render: (plant) => (
        <Stack gap={2} align="flex-start">
          <Pill tone={plant.ownership === 'owned' ? 'info' : 'neutral'}>
            {PLANT_OWNERSHIP_LABELS[plant.ownership]}
          </Pill>
          <Text size="xs" c={COLORS.muted}>
            {plant.company.name}
          </Text>
        </Stack>
      ),
    },
    {
      key: 'site',
      header: 'Site',
      sortField: 'site',
      render: (plant) => (
        <Stack gap={0}>
          <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
            {plant.site.name}
          </Text>
          {plant.area && (
            <Text size="xs" c={COLORS.muted}>
              {plant.area.name}
            </Text>
          )}
        </Stack>
      ),
    },
    {
      key: 'documents',
      header: 'Documents',
      width: 190,
      render: (plant) => <ComplianceBadge state={plant.compliance} />,
    },
    {
      key: 'status',
      header: 'Status',
      sortField: 'status',
      width: 210,
      render: (plant) => (
        <PlantStatusBadge
          status={plant.status}
          archived={!!plant.archivedAt}
          reason={plant.restrictionReason}
        />
      ),
    },
  ];

  const cards: Array<{
    label: string;
    value: number | undefined;
    status: PlantStatus | null;
    icon: typeof IconBuildingFactory2;
  }> = [
    {
      label: 'All plant',
      value: counts.all,
      status: null,
      icon: IconBuildingFactory2,
    },
    {
      label: PLANT_STATUS_LABELS.pending_reception,
      value: counts.pending,
      status: 'pending_reception',
      icon: IconClockHour4,
    },
    {
      label: PLANT_STATUS_LABELS.awaiting_approval,
      value: counts.awaiting,
      status: 'awaiting_approval',
      icon: IconHourglass,
    },
    {
      label: PLANT_STATUS_LABELS.approved,
      value: counts.approved,
      status: 'approved',
      icon: IconCircleCheck,
    },
    {
      label: PLANT_STATUS_LABELS.restricted,
      value: counts.restricted,
      status: 'restricted',
      icon: IconAlertTriangle,
    },
  ];

  return (
    <>
      <AppPageHeader
        title="Plant"
        description="Every plant item at your sites, with its status, ownership and location."
        actions={
          <Group gap="sm">
            {(can('plant.export') || can('plant.qr')) && (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <Button
                    variant="default"
                    rightSection={<IconChevronDown size={16} />}
                    loading={busy}
                  >
                    Export
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Uses the current search and filters</Menu.Label>
                  {can('plant.export') && (
                    <>
                      <Menu.Item
                        leftSection={<IconDownload size={16} />}
                        onClick={() =>
                          download(
                            '/plants/export',
                            { format: 'xlsx' },
                            'plant-register.xlsx',
                          )
                        }
                      >
                        Excel (.xlsx)
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<IconDownload size={16} />}
                        onClick={() =>
                          download(
                            '/plants/export',
                            { format: 'csv' },
                            'plant-register.csv',
                          )
                        }
                      >
                        CSV
                      </Menu.Item>
                    </>
                  )}
                  {can('plant.qr') && (
                    <Menu.Item
                      leftSection={<IconQrcode size={16} />}
                      disabled={!data?.total}
                      onClick={() =>
                        download('/plants/qr-labels', {}, 'plant-qr-labels.pdf')
                      }
                    >
                      QR labels (PDF)
                    </Menu.Item>
                  )}
                </Menu.Dropdown>
              </Menu>
            )}
            {can('plant.import') && (
              <Button
                variant="default"
                leftSection={<IconFileImport size={16} />}
                onClick={() => router.push('/plant/import')}
              >
                Import
              </Button>
            )}
            {can('plant.create') && (
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() => router.push('/plant/new')}
              >
                Add plant
              </Button>
            )}
          </Group>
        }
      />

      <SimpleGrid cols={{ base: 2, sm: 3, xl: 5 }} mb="lg" spacing="sm">
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value ?? '—'}
            icon={<card.icon size={20} />}
            selected={filters.status === card.status}
            onClick={() => apply({ ...filters, status: card.status })}
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
              placeholder="Search ID, number, serial, name, make or model"
              label="Search plant"
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
            rowKey={(plant) => plant.id}
            loading={isFetching}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            onRowClick={(plant) => router.push(`/plant/${plant.id}`)}
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
                    ? 'No plant matches these filters'
                    : 'No plant at your sites yet'
                }
                message={
                  filtered
                    ? 'Try removing a filter or searching for something else.'
                    : 'Register plant when it arrives on site; it starts as Pending Reception.'
                }
                action={
                  filtered ? (
                    <Button variant="light" onClick={clearAll}>
                      Clear filters
                    </Button>
                  ) : (
                    can('plant.create') && (
                      <Button onClick={() => router.push('/plant/new')}>
                        Add plant
                      </Button>
                    )
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
          apply(draft);
          panel.close();
        }}
        onClear={() => {
          apply(NO_FILTERS);
          panel.close();
        }}
        sections={[
          {
            key: 'status',
            label: 'Status',
            count: draft.status ? 1 : 0,
            content: single(
              'status',
              [...PLANT_STATUSES, 'archived' as const].map((status) => ({
                value: status,
                label: PLANT_STATUS_LABELS[status],
              })),
              'status',
            ),
          },
          {
            key: 'site',
            label: 'Site',
            count: draft.siteId ? 1 : 0,
            content: single('siteId', named(sites.data), 'site'),
          },
          {
            key: 'type',
            label: 'Plant type',
            count: draft.plantTypeId ? 1 : 0,
            content: single('plantTypeId', named(types.data), 'plant type'),
          },
          {
            key: 'category',
            label: 'Category',
            count: draft.categoryId ? 1 : 0,
            content: single('categoryId', named(categories.data), 'category'),
          },
          {
            key: 'ownership',
            label: 'Ownership',
            count: draft.ownership ? 1 : 0,
            content: single(
              'ownership',
              PLANT_OWNERSHIPS.map((ownership) => ({
                value: ownership,
                label: PLANT_OWNERSHIP_LABELS[ownership],
              })),
              'ownership',
            ),
          },
          {
            key: 'documents',
            label: 'Documents',
            count: draft.compliance ? 1 : 0,
            content: single(
              'compliance',
              PLANT_COMPLIANCE_STATES.map((state) => ({
                value: state,
                label: PLANT_COMPLIANCE_LABELS[state],
              })),
              'documents',
            ),
          },
          {
            key: 'company',
            label: 'Owner or hire company',
            count: draft.companyId ? 1 : 0,
            content: single('companyId', named(companies.data), 'company'),
          },
        ]}
      />
    </>
  );
}
