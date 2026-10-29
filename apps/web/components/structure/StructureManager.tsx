'use client';

import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  TagsInput,
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

/** A form value: text, a number ('' while blank), a switch or a list of texts. */
export type FieldValue = string | number | boolean | string[];
export type FieldValues = Record<string, FieldValue>;

export interface FieldSpec {
  key: string;
  label: string;
  required?: boolean;
  description?: string;
  /** How the field is entered; text when omitted. */
  type?: 'text' | 'number' | 'select' | 'switch' | 'tags';
  /** The choices of a select field. */
  options?: { value: string; label: string }[];
  /** Value of a new item; blank (or off) when omitted. */
  defaultValue?: FieldValue;
  /** Chosen when the item is created and shown read-only afterwards. */
  createOnly?: boolean;
  /** Shown only while this returns true for the form's current values. */
  visible?: (values: FieldValues) => boolean;
  min?: number;
  max?: number;
  placeholder?: string;
}

/** A text field's value, '' when it is not text. */
export const textValue = (value: FieldValue | undefined): string =>
  typeof value === 'string' ? value : '';

/** A number field's value, undefined while it is blank. */
export const numberValue = (
  value: FieldValue | undefined,
): number | undefined => (typeof value === 'number' ? value : undefined);

const blankFor = (field: FieldSpec): FieldValue => {
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.type === 'switch') return false;
  if (field.type === 'tags') return [];
  return '';
};

/** An item's stored value in the form's shape. */
const valueOf = (field: FieldSpec, stored: unknown): FieldValue => {
  if (stored === null || stored === undefined) return blankFor(field);
  if (field.type === 'switch') return Boolean(stored);
  if (field.type === 'tags')
    return Array.isArray(stored) ? stored.map(String) : [];
  if (field.type === 'number')
    return typeof stored === 'number' ? stored : blankFor(field);
  return String(stored);
};

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
  onCreate: (values: FieldValues) => Promise<Result>;
  onUpdate: (id: string, values: FieldValues) => Promise<Result>;
  onArchive: (id: string, archived: boolean) => Promise<Result>;
}

/**
 * Create, edit, archive and restore one list of organisation structure or
 * configuration (FRD ORG-001, ADM-003). Archived items stay in history but
 * cannot be newly assigned.
 */
export function StructureManager<T extends StructureItem>(props: Props<T>) {
  const { noun, fields } = props;
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const visibleItems = term
    ? props.items?.filter((item) => item.name.toLowerCase().includes(term))
    : props.items;
  const blank = Object.fromEntries(
    fields.map((field) => [field.key, blankFor(field)]),
  );
  const isShown = (field: FieldSpec, values: FieldValues) =>
    !field.visible || field.visible(values);
  const form = useForm<FieldValues>({
    initialValues: blank,
    validate: Object.fromEntries(
      fields
        .filter((field) => field.required)
        .map((field) => [
          field.key,
          (value: FieldValue, values: FieldValues) =>
            // A blank number is '' too, so only text can be empty.
            !isShown(field, values) ||
            typeof value !== 'string' ||
            value.trim() !== ''
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
              valueOf(field, (item as Record<string, unknown>)[field.key]),
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

  const renderField = (field: FieldSpec) => {
    const locked = field.createOnly && editing !== 'new';
    const common = {
      label: field.label,
      description: locked
        ? `${field.description ? `${field.description} ` : ''}Set when the ${noun.toLowerCase()} was created.`
        : field.description,
      required: field.required,
      disabled: locked,
      placeholder: field.placeholder,
    };
    switch (field.type) {
      case 'number':
        return (
          <NumberInput
            key={field.key}
            {...common}
            min={field.min}
            max={field.max}
            allowDecimal={false}
            {...form.getInputProps(field.key)}
          />
        );
      case 'select':
        return (
          <Select
            key={field.key}
            {...common}
            data={field.options ?? []}
            allowDeselect={false}
            {...form.getInputProps(field.key)}
          />
        );
      case 'switch':
        return (
          <Switch
            key={field.key}
            label={field.label}
            description={common.description}
            disabled={locked}
            {...form.getInputProps(field.key, { type: 'checkbox' })}
          />
        );
      case 'tags':
        return (
          <TagsInput
            key={field.key}
            {...common}
            {...form.getInputProps(field.key)}
          />
        );
      default:
        return (
          <TextInput
            key={field.key}
            {...common}
            {...form.getInputProps(field.key)}
          />
        );
    }
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
            {fields
              .filter((field) => isShown(field, form.values))
              .map(renderField)}
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
