'use client';

import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Modal,
  MultiSelect,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import {
  IconDotsVertical,
  IconKey,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconPlus,
  IconUserCheck,
  IconUserOff,
  IconUsers,
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  type IssuedCredentials,
  type UserStatus,
  USER_STATUS_LABELS,
  USER_STATUSES,
  type UserSummary,
  type UserWithCredentials,
} from '@corecheck/shared';
import {
  type Column,
  COLORS,
  confirmAction,
  CredentialsCard,
  DataTable,
  EmptyState,
  ErrorAlert,
  FilterButton,
  FilterPanel,
  formatDateTime,
  Pill,
  SearchInput,
  type SortState,
  StatCard,
  TableCard,
  UserStatusBadge,
  DEFAULT_PAGE_SIZE,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../../components/AppPageHeader';
import {
  useSeatUsageQuery,
  useUserActionMutation,
  useUsersQuery,
} from '../../../../lib/api';
import { useRoleOptions, useScopeOptions } from '../../../../lib/options';
import { useSession } from '../../../../lib/session';

interface Filters {
  status: UserStatus | null;
  roleId: string | null;
  siteId: string | null;
  teamId: string | null;
  disciplineId: string | null;
}
const NO_FILTERS: Filters = {
  status: null,
  roleId: null,
  siteId: null,
  teamId: null,
  disciplineId: null,
};

const names = (items: { name: string }[]) =>
  items.map((item) => item.name).join(', ') || '—';

/** Totals for the status cards, read from the same list the table uses. */
const useStatusCount = (status?: UserStatus) =>
  useUsersQuery({ page: 1, pageSize: 1, status }).data?.total;

export default function UsersPage() {
  const router = useRouter();
  const { me, can } = useSession();
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [panelOpen, panel] = useDisclosure();
  const [sort, setSort] = useState<SortState>({ field: 'name', order: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const { data, isFetching, error } = useUsersQuery({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    status: filters.status ?? undefined,
    roleId: filters.roleId ?? undefined,
    siteId: filters.siteId ?? undefined,
    teamId: filters.teamId ?? undefined,
    disciplineId: filters.disciplineId ?? undefined,
    sort: sort.field as 'name',
    order: sort.order,
  });
  const { data: seats } = useSeatUsageQuery();
  const counts = {
    all: useStatusCount(),
    active: useStatusCount('active'),
    locked: useStatusCount('locked'),
    inactive: useStatusCount('inactive'),
  };
  const roles = useRoleOptions();
  const scope = useScopeOptions();
  const [runAction] = useUserActionMutation();
  const [issued, setIssued] = useState<{
    credentials: IssuedCredentials;
    name: string;
  } | null>(null);
  const tz = me?.organisation.timeZone;

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

  // Each filter takes one value; a one-item multi-select keeps the panel
  // reading like CoreStock's and can be cleared in place.
  const single = (
    key: keyof Filters,
    options: { value: string; label: string }[],
    label: string,
  ) => (
    <MultiSelect
      data={options}
      value={draft[key] ? [draft[key]!] : []}
      onChange={(values) =>
        setDraft((current) => ({
          ...current,
          [key]: values.at(-1) ?? null,
        }))
      }
      placeholder="Any"
      searchable
      clearable
      aria-label={`Filter by ${label}`}
    />
  );

  const act = async (
    user: UserSummary,
    action: 'deactivate' | 'reactivate' | 'reset-pin' | 'unlock',
  ) => {
    const result = await runAction({ id: user.id, action });
    if (result.error || action !== 'reset-pin') return;
    setIssued({
      credentials: (result.data as UserWithCredentials).credentials,
      name: `${user.firstName} ${user.lastName}`,
    });
  };

  const actions = (user: UserSummary) => {
    const caps = user.capabilities;
    const name = `${user.firstName} ${user.lastName}`;
    const items = [
      caps.canEdit && (
        <Menu.Item
          key="edit"
          leftSection={<IconPencil size={14} />}
          onClick={() => router.push(`/admin/users/${user.id}`)}
        >
          Edit
        </Menu.Item>
      ),
      caps.canResetPin && (
        <Menu.Item
          key="reset"
          leftSection={<IconKey size={14} />}
          onClick={() =>
            confirmAction({
              title: 'Reset PIN?',
              message: `${name} will get a new temporary PIN and be signed out. Their account is unlocked if it was locked.`,
              confirmLabel: 'Reset PIN',
              onConfirm: () => act(user, 'reset-pin'),
            })
          }
        >
          Reset PIN
        </Menu.Item>
      ),
      caps.canUnlock && (
        <Menu.Item
          key="unlock"
          leftSection={<IconLockOpen size={14} />}
          onClick={() => act(user, 'unlock')}
        >
          Unlock
        </Menu.Item>
      ),
      caps.canReactivate && (
        <Menu.Item
          key="reactivate"
          leftSection={<IconUserCheck size={14} />}
          onClick={() => act(user, 'reactivate')}
        >
          Reactivate
        </Menu.Item>
      ),
      caps.canDeactivate && (
        <Menu.Item
          key="deactivate"
          color="red"
          leftSection={<IconUserOff size={14} />}
          onClick={() =>
            confirmAction({
              title: 'Deactivate user?',
              message: `${name} will be signed out and unable to sign in. Their history is kept and their seat is freed.`,
              confirmLabel: 'Deactivate',
              danger: true,
              onConfirm: () => act(user, 'deactivate'),
            })
          }
        >
          Deactivate
        </Menu.Item>
      ),
    ].filter(Boolean);
    if (items.length === 0) return null;
    return (
      // The row opens the user on click; the menu must not.
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={`Actions for ${name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <IconDotsVertical size={18} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
          {items}
        </Menu.Dropdown>
      </Menu>
    );
  };

  const columns: Column<UserSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      sortField: 'name',
      render: (user) => (
        <Stack gap={0}>
          <Text
            fw={600}
            size="sm"
            c={COLORS.title}
            style={{ whiteSpace: 'nowrap' }}
          >
            {user.firstName} {user.lastName}
          </Text>
          <Text size="xs" c={COLORS.muted}>
            {user.username}
          </Text>
        </Stack>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortField: 'role',
      width: 200,
      render: (user) => (
        <Group gap={6} wrap="nowrap">
          <Pill>{user.role.name}</Pill>
          {!user.role.standardKey && <Pill tone="info">Custom</Pill>}
        </Group>
      ),
    },
    {
      key: 'sites',
      header: 'Site Access',
      render: (user) => <Text size="sm">{names(user.sites)}</Text>,
    },
    {
      key: 'teams',
      header: 'Teams',
      render: (user) => <Text size="sm">{names(user.teams)}</Text>,
    },
    {
      key: 'lastLoginAt',
      header: 'Last Login',
      sortField: 'lastLoginAt',
      width: 170,
      render: (user) => (
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
          {formatDateTime(user.lastLoginAt, tz)}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortField: 'status',
      width: 120,
      render: (user) => <UserStatusBadge status={user.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      width: 90,
      align: 'right',
      render: actions,
    },
  ];

  const cards: Array<{
    label: string;
    value: number | undefined;
    status: UserStatus | null;
    icon: typeof IconUsers;
  }> = [
    { label: 'Total Users', value: counts.all, status: null, icon: IconUsers },
    {
      label: 'Active',
      value: counts.active,
      status: 'active',
      icon: IconUserCheck,
    },
    { label: 'Locked', value: counts.locked, status: 'locked', icon: IconLock },
    {
      label: 'Inactive',
      value: counts.inactive,
      status: 'inactive',
      icon: IconUserOff,
    },
  ];

  return (
    <>
      <AppPageHeader
        title="Users"
        description={
          seats
            ? `${seats.used} of ${seats.limit} licensed seats in use. Inactive users do not use a seat.`
            : 'People who can sign in to your CoreCheck workspace.'
        }
        actions={
          can('users.manage') && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => router.push('/admin/users/new')}
              disabled={seats?.available === 0}
            >
              Add New User
            </Button>
          )
        }
      />
      {seats?.available === 0 && can('users.manage') && (
        <Text c="red.7" size="sm" mb="md" fw={500}>
          All seats are in use. Deactivate a user or contact CoreCheck to add
          seats.
        </Text>
      )}

      <SimpleGrid cols={{ base: 2, xl: 4 }} mb="lg" spacing="sm">
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
              placeholder="Search name, username or email"
              label="Search users"
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
            rowKey={(user) => user.id}
            loading={isFetching}
            sort={sort}
            onSortChange={(next) => {
              setSort(next);
              setPage(1);
            }}
            onRowClick={(user) => router.push(`/admin/users/${user.id}`)}
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
                    ? 'No users match these filters'
                    : 'No users in your scope yet'
                }
                message={
                  filtered
                    ? 'Try removing a filter or searching for something else.'
                    : 'Users you can see share one of your sites or teams.'
                }
                action={
                  filtered ? (
                    <Button variant="light" onClick={clearAll}>
                      Clear filters
                    </Button>
                  ) : (
                    can('users.manage') && (
                      <Button onClick={() => router.push('/admin/users/new')}>
                        Add a user
                      </Button>
                    )
                  )
                }
              />
            }
          />
        )}
      </TableCard>

      <Modal
        opened={!!issued}
        onClose={() => setIssued(null)}
        title="New temporary PIN"
        size="lg"
      >
        {issued && (
          <CredentialsCard
            credentials={issued.credentials}
            personName={issued.name}
            timeZone={tz}
          />
        )}
      </Modal>

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
              USER_STATUSES.map((status) => ({
                value: status,
                label: USER_STATUS_LABELS[status],
              })),
              'status',
            ),
          },
          {
            key: 'role',
            label: 'Role',
            count: draft.roleId ? 1 : 0,
            content: single('roleId', roles, 'role'),
          },
          {
            key: 'site',
            label: 'Site',
            count: draft.siteId ? 1 : 0,
            content: single('siteId', scope.sites, 'site'),
          },
          {
            key: 'team',
            label: 'Team',
            count: draft.teamId ? 1 : 0,
            content: single('teamId', scope.teams, 'team'),
          },
          {
            key: 'discipline',
            label: 'Discipline',
            count: draft.disciplineId ? 1 : 0,
            content: single('disciplineId', scope.disciplines, 'discipline'),
          },
        ]}
      />
    </>
  );
}
