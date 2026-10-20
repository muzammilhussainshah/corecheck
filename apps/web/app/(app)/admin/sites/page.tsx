'use client';

import {
  ActionIcon,
  Button,
  Drawer,
  Group,
  Menu,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconArchive,
  IconCheck,
  IconMap2,
  IconPencil,
  IconRestore,
  IconX,
} from '@tabler/icons-react';
import { useState } from 'react';
import type { ApiError, Area, Site } from '@corecheck/shared';
import { ArchivedBadge, showApiErrors } from '@corecheck/ui';
import { StructureManager } from '../../../../components/structure/StructureManager';
import {
  useAreasQuery,
  useCreateAreaMutation,
  useCreateStructureMutation,
  useSetStructureArchivedMutation,
  useSitesQuery,
  useUpdateAreaMutation,
  useUpdateStructureMutation,
} from '../../../../lib/api';

/** One area in the drawer: its name, renamed in place (ORG-002). */
function AreaRow({ area }: { area: Area }) {
  const [editing, setEditing] = useState(false);
  const [updateArea, { isLoading }] = useUpdateAreaMutation();
  const [setArchived] = useSetStructureArchivedMutation();
  const form = useForm({ initialValues: { name: area.name } });

  const save = form.onSubmit(async ({ name }) => {
    const result = await updateArea({ id: area.id, name });
    if (result.error) return showApiErrors(form, result.error as ApiError);
    setEditing(false);
  });

  if (editing)
    return (
      <form onSubmit={save}>
        <Group align="flex-start" wrap="nowrap" gap="xs">
          <TextInput
            aria-label={`New name for ${area.name}`}
            size="sm"
            style={{ flex: 1 }}
            autoFocus
            {...form.getInputProps('name')}
          />
          <ActionIcon
            type="submit"
            size={36}
            loading={isLoading}
            aria-label="Save name"
          >
            <IconCheck size={16} />
          </ActionIcon>
          <ActionIcon
            variant="default"
            size={36}
            aria-label="Cancel"
            onClick={() => {
              form.setValues({ name: area.name });
              form.clearErrors();
              setEditing(false);
            }}
          >
            <IconX size={16} />
          </ActionIcon>
        </Group>
      </form>
    );

  return (
    <Group justify="space-between" wrap="nowrap">
      <Group gap={6}>
        <Text size="sm">{area.name}</Text>
        {area.archivedAt && <ArchivedBadge />}
      </Group>
      <Group gap={4} wrap="nowrap">
        <ActionIcon
          variant="subtle"
          aria-label={`Rename ${area.name}`}
          onClick={() => {
            form.setValues({ name: area.name });
            setEditing(true);
          }}
        >
          <IconPencil size={16} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          aria-label={
            area.archivedAt ? `Restore ${area.name}` : `Archive ${area.name}`
          }
          onClick={async () => {
            await setArchived({
              kind: 'areas',
              id: area.id,
              archived: !area.archivedAt,
            });
          }}
        >
          {area.archivedAt ? (
            <IconRestore size={16} />
          ) : (
            <IconArchive size={16} />
          )}
        </ActionIcon>
      </Group>
    </Group>
  );
}

/** Locations or areas within a site (ORG-002). */
function AreasDrawer({
  site,
  onClose,
}: {
  site: Site | null;
  onClose: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const { data: areas } = useAreasQuery(
    { siteId: site?.id ?? '', includeArchived: showArchived },
    { skip: !site },
  );
  const [createArea, { isLoading }] = useCreateAreaMutation();
  const form = useForm({ initialValues: { name: '' } });

  const add = form.onSubmit(async ({ name }) => {
    if (!site) return;
    const result = await createArea({ siteId: site.id, name });
    if (result.error) return showApiErrors(form, result.error as ApiError);
    form.reset();
  });

  return (
    <Drawer
      opened={!!site}
      onClose={onClose}
      title={site ? `Locations and areas at ${site.name}` : ''}
      position="right"
      size="md"
    >
      <Stack>
        <form onSubmit={add}>
          <Group align="flex-end" wrap="nowrap">
            <TextInput
              label="New area"
              placeholder="e.g. Yard A"
              style={{ flex: 1 }}
              {...form.getInputProps('name')}
            />
            <Button type="submit" loading={isLoading}>
              Add
            </Button>
          </Group>
        </form>
        <Switch
          label="Show archived"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.currentTarget.checked)}
        />
        {(areas ?? []).length === 0 && (
          <Text c="dimmed" size="sm">
            No areas yet.
          </Text>
        )}
        {(areas ?? []).map((area) => (
          <AreaRow key={area.id} area={area} />
        ))}
      </Stack>
    </Drawer>
  );
}

export default function SitesPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [areasOf, setAreasOf] = useState<Site | null>(null);
  const { data, isFetching, error } = useSitesQuery({
    includeArchived: showArchived,
  });
  const [create] = useCreateStructureMutation();
  const [update] = useUpdateStructureMutation();
  const [setArchived] = useSetStructureArchivedMutation();

  return (
    <>
      <StructureManager<Site>
        title="Sites"
        description="Where plant is kept and work happens. Users see records at the sites assigned to them."
        noun="Site"
        items={data}
        loading={isFetching}
        error={error}
        showArchived={showArchived}
        onShowArchivedChange={setShowArchived}
        fields={[
          { key: 'name', label: 'Name', required: true },
          {
            key: 'code',
            label: 'Code',
            description: 'Optional short reference, e.g. LDS.',
          },
          { key: 'address', label: 'Address' },
        ]}
        extraColumns={[
          {
            key: 'code',
            header: 'Code',
            render: (site) => <Text size="sm">{site.code ?? '—'}</Text>,
          },
          {
            key: 'address',
            header: 'Address',
            render: (site) => (
              <Text size="sm" lineClamp={1}>
                {site.address ?? '—'}
              </Text>
            ),
          },
          {
            key: 'areas',
            header: 'Areas',
            align: 'right',
            render: (site) => <Text size="sm">{site.areaCount}</Text>,
          },
        ]}
        rowActions={(site) => (
          <Menu.Item
            leftSection={<IconMap2 size={16} />}
            onClick={() => setAreasOf(site)}
          >
            Locations / areas
          </Menu.Item>
        )}
        onCreate={(values) =>
          create({
            kind: 'sites',
            body: {
              name: values.name!,
              code: values.code,
              address: values.address,
            },
          })
        }
        onUpdate={(id, values) => update({ kind: 'sites', id, body: values })}
        onArchive={(id, archived) =>
          setArchived({ kind: 'sites', id, archived })
        }
      />
      <AreasDrawer site={areasOf} onClose={() => setAreasOf(null)} />
    </>
  );
}
