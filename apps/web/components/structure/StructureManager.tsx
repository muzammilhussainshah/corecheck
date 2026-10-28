'use client';

import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Modal,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconArchive,
  IconDotsVertical,
  IconPencil,
  IconPlus,
  IconRestore,
} from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
import type { ApiError } from '@corecheck/shared';
import {
  ArchivedBadge,
  type Column,
  DataTable,
  EmptyState,
  ErrorAlert,
  SearchInput,
  showApiErrors,
  TableCard,
} from '@corecheck/ui';
import { useOpenFromQuery } from '../../lib/useOpenFromQuery';
import { AppPageHeader } from '../AppPageHeader';

export interface StructureItem {
  id: string;
  name: string;
  archivedAt: string | null;
}

export interface FieldSpec {
  key: string;
  label: string;
  required?: boolean;
  description?: string;
}

type Result = { error?: unknown };

interface Props<T extends StructureItem> {
  title: string;
  description: string;
  noun: string;
  items: T[] | undefined;
  loading: boolean;
  error: unknown;
  showArchived: boolean;
  onShowArchivedChange: (value: boolean) => void;
  fields: FieldSpec[];
  extraColumns?: Column<T>[];
  rowActions?: (item: T) => ReactNode;
  onCreate: (values: Record<string, string>) => Promise<Result>;
  onUpdate: (id: string, values: Record<string, string>) => Promise<Result>;
  onArchive: (id: string, archived: boolean) => Promise<Result>;
}

/**
 * Create, rename, archive and restore one kind of organisation structure
 * (FRD ORG-001). Archived items stay in history but cannot be newly assigned.
 */
export function StructureManager<T extends StructureItem>(props: Props<T>) {
  const { noun, fields } = props;
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const visibleItems = term
    ? props.items?.filter((item) => item.name.toLowerCase().includes(term))
    : props.items;
  const blank = Object.fromEntries(fields.map((field) => [field.key, '']));
  const form = useForm<Record<string, string>>({
    initialValues: blank,
    validate: Object.fromEntries(
      fields
        .filter((field) => field.required)
        .map((field) => [
          field.key,
          (value: string) =>
            value?.trim()
              ? null
              : `${noun} ${field.label.toLowerCase()} is required.`,
        ]),
    ),
  });

  const open = (item: T | 'new') => {
    form.setValues(
      item === 'new'
        ? blank
        : Object.fromEntries(
            fields.map((field) => [
              field.key,
              String((item as Record<string, unknown>)[field.key] ?? ''),
            ]),
          ),
    );
    form.clearErrors();
    setEditing(item);
  };
  useOpenFromQuery(() => open('new'));

  const submit = form.onSubmit(async (values) => {
    const result =
      editing === 'new'
        ? await props.onCreate(values)
        : await props.onUpdate((editing as T).id, values);
    if (result.error) return showApiErrors(form, result.error as ApiError);
    setEditing(null);
  });

  const archive = async (item: T, archived: boolean) => {
    await props.onArchive(item.id, archived);
  };

  const columns: Column<T>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (item) => (
        <Group gap={6}>
          <Text fw={600} size="sm">
            {item.name}
          </Text>
          {item.archivedAt && <ArchivedBadge />}
        </Group>
      ),
    },
    ...(props.extraColumns ?? []),
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: 90,
      render: (item) => (
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              aria-label={`Actions for ${item.name}`}
            >
              <IconDotsVertical size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {props.rowActions?.(item)}
            <Menu.Item
              leftSection={<IconPencil size={16} />}
              onClick={() => open(item)}
            >
              Edit
            </Menu.Item>
            {item.archivedAt ? (
              <Menu.Item
                leftSection={<IconRestore size={16} />}
                onClick={() => archive(item, false)}
              >
                Restore
              </Menu.Item>
            ) : (
              <Menu.Item
                color="red"
                leftSection={<IconArchive size={16} />}
                onClick={() => archive(item, true)}
              >
                Archive
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      ),
    },
  ];

  return (
    <>
      <AppPageHeader
        title={props.title}
        description={props.description}
        actions={
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => open('new')}
          >
            Add {noun.toLowerCase()}
          </Button>
        }
      />
      <TableCard
        toolbar={
          <>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={`Search ${noun.toLowerCase()}s`}
            />
            <Switch
              label="Show archived"
              checked={props.showArchived}
              onChange={(event) =>
                props.onShowArchivedChange(event.currentTarget.checked)
              }
            />
          </>
        }
      >
        {props.error ? (
          <ErrorAlert error={props.error as ApiError} />
        ) : (
          <DataTable
            columns={columns}
            rows={visibleItems}
            rowKey={(item) => item.id}
            loading={props.loading}
            empty={
              <EmptyState
                title={`No ${noun.toLowerCase()}s yet`}
                action={
                  <Button onClick={() => open('new')}>
                    Add {noun.toLowerCase()}
                  </Button>
                }
              />
            }
          />
        )}
      </TableCard>
      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing === 'new'
            ? `Add ${noun.toLowerCase()}`
            : `Edit ${noun.toLowerCase()}`
        }
      >
        <form onSubmit={submit} noValidate>
          <Stack>
            {fields.map((field) => (
              <TextInput
                key={field.key}
                label={field.label}
                description={field.description}
                required={field.required}
                {...form.getInputProps(field.key)}
              />
            ))}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
