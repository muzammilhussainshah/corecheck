'use client';

import {
  Box,
  Button,
  Center,
  Group,
  Loader,
  Pagination,
  ScrollArea,
  Select,
  Table,
  Text,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconArrowRight,
  IconChevronDown,
  IconChevronUp,
  IconSelector,
} from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
import { COLORS } from './theme';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** The sort field this column sorts by, when sortable. */
  sortField?: string;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
}

export interface SortState {
  field: string;
  order: 'asc' | 'desc';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Shown when there are no rows (LST-005). */
  empty: ReactNode;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  onRowClick?: (row: T) => void;
  /**
   * Server-side paging. Without it the table pages the rows it was given
   * itself, so a long register never turns into an endless scroll.
   */
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
    onPageSizeChange?: (pageSize: number) => void;
  };
}

export const PAGE_SIZE_OPTIONS = [10, 25, 50];
export const DEFAULT_PAGE_SIZE = 10;

const SortIcon = ({
  active,
  order,
}: {
  active: boolean;
  order: 'asc' | 'desc';
}) => {
  if (!active) return <IconSelector size={14} opacity={0.5} />;
  return order === 'asc' ? (
    <IconChevronUp size={14} />
  ) : (
    <IconChevronDown size={14} />
  );
};

/**
 * Registers and work lists (LST-001..005) in the CoreStock style: a bordered
 * table with a pale heading row, then "Showing 1 to 10 of 42" with Previous
 * and Next. Wide tables scroll inside themselves on small screens.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  sort,
  onSortChange,
  onRowClick,
  pagination: serverPagination,
}: DataTableProps<T>) {
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(DEFAULT_PAGE_SIZE);

  if (loading && !rows) {
    return (
      <Center py={48} style={{ flex: '1 0 auto' }}>
        <Loader />
      </Center>
    );
  }
  if (!rows || rows.length === 0)
    return (
      <Center p="md" style={{ flex: '1 0 auto' }}>
        {empty}
      </Center>
    );

  const header = (column: Column<T>) => {
    if (!column.sortField || !onSortChange || !sort) return column.header;
    const active = sort.field === column.sortField;
    return (
      <UnstyledButton
        onClick={() =>
          onSortChange({
            field: column.sortField!,
            order: active && sort.order === 'asc' ? 'desc' : 'asc',
          })
        }
        aria-label={`Sort by ${column.header}`}
        style={{ font: 'inherit', color: 'inherit' }}
      >
        <Group
          gap={4}
          wrap="nowrap"
          justify={
            column.align === 'right'
              ? 'flex-end'
              : column.align === 'center'
                ? 'center'
                : 'flex-start'
          }
        >
          <span>{column.header}</span>
          <SortIcon active={active} order={sort.order} />
        </Group>
      </UnstyledButton>
    );
  };

  // Local paging: clamp the page when a search or filter shortens the list.
  const localPages = Math.max(1, Math.ceil(rows.length / localPageSize));
  const clampedLocalPage = Math.min(localPage, localPages);
  const pagination = serverPagination ?? {
    page: clampedLocalPage,
    pageSize: localPageSize,
    total: rows.length,
    onChange: setLocalPage,
    onPageSizeChange: (size: number) => {
      setLocalPageSize(size);
      setLocalPage(1);
    },
  };
  const pageRows = serverPagination
    ? rows
    : rows.slice(
        (clampedLocalPage - 1) * localPageSize,
        clampedLocalPage * localPageSize,
      );

  const pages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const first = (pagination.page - 1) * pagination.pageSize + 1;
  const last = Math.min(pagination.total, first + pageRows.length - 1);

  return (
    <>
      <Box
        m="md"
        style={{
          border: `1px solid ${COLORS.borderStrong}`,
          borderRadius: 12,
          overflow: 'hidden',
          // The bordered table runs down to the pagination row.
          flex: '1 0 auto',
        }}
      >
        <ScrollArea type="auto">
          <Table
            highlightOnHover={!!onRowClick}
            highlightOnHoverColor="#F9FAFB"
            verticalSpacing={14}
            horizontalSpacing="md"
            miw={680}
            style={{ opacity: loading ? 0.6 : 1 }}
          >
            <Table.Thead>
              <Table.Tr>
                {columns.map((column) => (
                  <Table.Th
                    key={column.key}
                    ta={column.align}
                    w={column.width}
                    aria-sort={
                      sort && column.sortField === sort.field
                        ? sort.order === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    {header(column)}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pageRows.map((row) => (
                <Table.Tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  {columns.map((column) => (
                    <Table.Td key={column.key} ta={column.align}>
                      {column.render(row)}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Box>
      <Group
        justify="space-between"
        px="md"
        py="sm"
        wrap="wrap"
        style={{ borderTop: `1px solid ${COLORS.borderStrong}` }}
      >
        <Group gap="lg" wrap="wrap">
          <Text size="sm" c={COLORS.muted} fw={500}>
            Showing {first} to {last} of {pagination.total}
          </Text>
          {pagination.onPageSizeChange &&
            pagination.total > PAGE_SIZE_OPTIONS[0]! && (
              <Group gap={8} wrap="nowrap">
                <Text size="sm" c={COLORS.muted} fw={500}>
                  Rows per page
                </Text>
                <Select
                  aria-label="Rows per page"
                  size="xs"
                  w={76}
                  allowDeselect={false}
                  data={PAGE_SIZE_OPTIONS.map(String)}
                  value={String(pagination.pageSize)}
                  onChange={(value) =>
                    value && pagination.onPageSizeChange?.(Number(value))
                  }
                />
              </Group>
            )}
        </Group>
        {pages > 1 && (
          <Group gap="xs" wrap="nowrap">
            <Button
              variant="default"
              size="xs"
              h={34}
              leftSection={<IconArrowLeft size={15} />}
              disabled={pagination.page <= 1}
              onClick={() => pagination.onChange(pagination.page - 1)}
            >
              Previous
            </Button>
            <Pagination
              total={pages}
              value={pagination.page}
              onChange={pagination.onChange}
              size="sm"
              withControls={false}
              visibleFrom="sm"
            />
            <Button
              variant="default"
              size="xs"
              h={34}
              rightSection={<IconArrowRight size={15} />}
              disabled={pagination.page >= pages}
              onClick={() => pagination.onChange(pagination.page + 1)}
            >
              Next
            </Button>
          </Group>
        )}
      </Group>
    </>
  );
}
