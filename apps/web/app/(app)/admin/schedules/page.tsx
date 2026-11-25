'use client';

import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  MultiSelect,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import {
  IconCalendarRepeat,
  IconDotsVertical,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconSquareX,
  IconPencil,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useState } from 'react';
import {
  type ApiError,
  CHECK_PURPOSES,
  type CheckSchedule,
  SCHEDULE_BASIS_LABELS,
  SCHEDULE_BASES,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_FREQUENCY_LABELS,
  SCHEDULE_UNIT_LABELS,
  SCHEDULE_UNITS,
  type ScheduleBasis,
  type ScheduleFrequency,
  type ScheduleUnit,
} from '@corecheck/shared';
import {
  type Column,
  confirmAction,
  DataTable,
  EmptyState,
  ErrorAlert,
  formatDate,
  SearchInput,
  TableCard,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../../components/AppPageHeader';
import {
  type AssigneeValues,
  AssigneeFields,
} from '../../../../components/checks/AssigneeFields';
import {
  assigneeText,
  CheckStatusBadge,
  ScheduleStateBadge,
} from '../../../../components/checks/badges';
import {
  useCreateScheduleMutation,
  useLazyTemplateQuery,
  usePlantsQuery,
  useScheduleActionMutation,
  useSchedulesQuery,
  useTemplatesQuery,
  useUpdateScheduleMutation,
} from '../../../../lib/api';
import { useSession } from '../../../../lib/session';

interface RuleValues extends AssigneeValues {
  name: string;
  frequency: ScheduleFrequency;
  customUnit: ScheduleUnit | null;
  customCount: number | null;
  basis: ScheduleBasis;
  startOn: string;
  requiresApproval: boolean;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const fieldErrors = (error: unknown): Record<string, string> =>
  Object.fromEntries(
    ((error as ApiError).fieldErrors ?? []).map((item) => [
      item.field,
      item.message,
    ]),
  );

/** The rule itself: shared by creating and editing a schedule. */
function RuleFields({
  values,
  onChange,
  errors,
}: {
  values: RuleValues;
  onChange: (values: RuleValues) => void;
  errors: Record<string, string>;
}) {
  const set = (patch: Partial<RuleValues>) => onChange({ ...values, ...patch });
  return (
    <>
      <TextInput
        label="Schedule name"
        required
        placeholder="e.g. Daily pre-use check"
        value={values.name}
        onChange={(event) => set({ name: event.currentTarget.value })}
        error={errors.name}
      />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select
          label="Repeats"
          required
          allowDeselect={false}
          data={SCHEDULE_FREQUENCIES.map((frequency) => ({
            value: frequency,
            label: SCHEDULE_FREQUENCY_LABELS[frequency],
          }))}
          value={values.frequency}
          onChange={(value) =>
            set({
              frequency: value as ScheduleFrequency,
              customUnit: value === 'custom' ? (values.customUnit ?? 'week') : null,
              customCount: value === 'custom' ? (values.customCount ?? 2) : null,
            })
          }
        />
        <DateInput
          label="Start date"
          description="The first check is due on this date."
          required
          valueFormat="D MMM YYYY"
          value={values.startOn || null}
          onChange={(value) => set({ startOn: value ?? '' })}
          error={errors.startOn}
        />
      </SimpleGrid>
      {values.frequency === 'custom' && (
        <SimpleGrid cols={2}>
          <NumberInput
            label="Every"
            min={1}
            max={366}
            value={values.customCount ?? ''}
            onChange={(value) =>
              set({ customCount: typeof value === 'number' ? value : null })
            }
            error={errors.customCount}
          />
          <Select
            label="Unit"
            allowDeselect={false}
            data={SCHEDULE_UNITS.map((unit) => ({
              value: unit,
              label: SCHEDULE_UNIT_LABELS[unit],
            }))}
            value={values.customUnit}
            onChange={(value) => set({ customUnit: value as ScheduleUnit })}
          />
        </SimpleGrid>
      )}
      <Select
        label="Next check due"
        allowDeselect={false}
        data={SCHEDULE_BASES.map((basis) => ({
          value: basis,
          label: SCHEDULE_BASIS_LABELS[basis],
        }))}
        value={values.basis}
        onChange={(value) => set({ basis: value as ScheduleBasis })}
      />
      <Text size="sm" fw={500} mb={-8}>
        Assigned to
      </Text>
      <AssigneeFields
        value={values}
        onChange={(assignee) => set(assignee)}
        error={errors.assigneeUserId}
      />
      <Checkbox
        label="Checks need approval after submission"
        description="Only schedules with this set create an approval step."
        checked={values.requiresApproval}
        onChange={(event) => set({ requiresApproval: event.currentTarget.checked })}
      />
    </>
  );
}

function NewScheduleModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const [create, { isLoading }] = useCreateScheduleMutation();
  const { data: templates } = useTemplatesQuery();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [loadTemplate] = useLazyTemplateQuery();
  const [plantSearch, setPlantSearch] = useState('');
  const { data: plants } = usePlantsQuery({
    page: 1,
    pageSize: 100,
    search: plantSearch || undefined,
  });
  const [plantIds, setPlantIds] = useState<string[]>([]);
  const [values, setValues] = useState<RuleValues>({
    name: '',
    frequency: 'daily',
    customUnit: null,
    customCount: null,
    basis: 'completion',
    startOn: todayIso(),
    requiresApproval: false,
    assigneeUserId: null,
    assigneeTeamId: null,
    assigneeDisciplineId: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});

  // A template's suggested recurrence and approval fill the form (TMP-008).
  const chooseTemplate = async (id: string | null) => {
    setTemplateId(id);
    if (!id) return;
    const { data: template } = await loadTemplate(id);
    const version = template?.published;
    if (!template || !version) return;
    setValues((current) => ({
      ...current,
      name: current.name || template.name,
      requiresApproval: version.approvalMode === 'manual',
      ...(version.recurrence && {
        frequency: version.recurrence.frequency,
        customUnit: version.recurrence.customUnit,
        customCount: version.recurrence.customCount,
      }),
    }));
  };

  const usable = (templates ?? []).filter(
    (item) =>
      CHECK_PURPOSES.includes(item.purpose) &&
      item.publishedVersion &&
      !item.archivedAt,
  );
  const plantOptions = [
    ...Object.entries(chosen).map(([value, label]) => ({ value, label })),
    ...(plants?.items ?? [])
      .filter((plant) => !chosen[plant.id])
      .map((plant) => ({
        value: plant.id,
        label: `${plant.assetId} ${plant.name} (${plant.site.name})`,
      })),
  ];
  const submit = async () => {
    setErrors({});
    const result = await create({ ...values, templateId: templateId ?? '', plantIds });
    if (result.error) return setErrors(fieldErrors(result.error));
    onClose();
  };
  return (
    <Modal opened={opened} onClose={onClose} title="New schedule" size="lg">
      <Stack>
        <Select
          label="Template"
          required
          searchable
          data={usable.map((item) => ({
            value: item.id,
            label: `${item.name} (v${item.publishedVersion})`,
          }))}
          nothingFoundMessage="Publish an operational, technical or maintenance template first"
          value={templateId}
          onChange={(id) => void chooseTemplate(id)}
          error={errors.templateId}
        />
        <MultiSelect
          label="Plant"
          description="One schedule is created for each plant chosen."
          required
          searchable
          searchValue={plantSearch}
          onSearchChange={setPlantSearch}
          data={plantOptions}
          value={plantIds}
          onChange={(ids) => {
            setPlantIds(ids);
            setChosen(
              Object.fromEntries(
                ids.map((id) => [
                  id,
                  plantOptions.find((option) => option.value === id)?.label ?? id,
                ]),
              ),
            );
          }}
          error={
            errors.plantIds ??
            Object.entries(errors).find(([key]) => key.startsWith('plantIds.'))?.[1]
          }
        />
        <RuleFields values={values} onChange={setValues} errors={errors} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={submit}>
            Create schedule
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function EditScheduleModal({
  schedule,
  onClose,
}: {
  schedule: CheckSchedule;
  onClose: () => void;
}) {
  const [update, { isLoading }] = useUpdateScheduleMutation();
  const [values, setValues] = useState<RuleValues>({
    name: schedule.name,
    frequency: schedule.frequency,
    customUnit: schedule.customUnit,
    customCount: schedule.customCount,
    basis: schedule.basis,
    startOn: schedule.startOn,
    requiresApproval: schedule.requiresApproval,
    assigneeUserId: schedule.assignee.user?.id ?? null,
    assigneeTeamId: schedule.assignee.team?.id ?? null,
    assigneeDisciplineId: schedule.assignee.discipline?.id ?? null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    const result = await update({ id: schedule.id, ...values });
    if (result.error) return setErrors(fieldErrors(result.error));
    onClose();
  };
  return (
    <Modal opened onClose={onClose} title={`Edit ${schedule.name}`} size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          {schedule.template.name} on {schedule.plant.assetId}. Changes apply
          from the next check generated; a check already waiting keeps its due
          date (reschedule it on the Checks page).
        </Text>
        <RuleFields values={values} onChange={setValues} errors={errors} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={submit}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function PauseModal({
  schedule,
  onClose,
}: {
  schedule: CheckSchedule;
  onClose: () => void;
}) {
  const [act, { isLoading }] = useScheduleActionMutation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!reason.trim()) return setError('Give the reason.');
    const result = await act({ id: schedule.id, action: 'pause', reason });
    if (!result.error) onClose();
  };
  return (
    <Modal opened onClose={onClose} title={`Pause ${schedule.name}`}>
      <Stack>
        <Text size="sm" c="dimmed">
          No new checks are generated while paused. A check not yet due is
          withdrawn; one already due stays with its assignees.
        </Text>
        <Textarea
          label="Reason"
          required
          autosize
          minRows={2}
          value={reason}
          onChange={(event) => {
            setReason(event.currentTarget.value);
            setError(null);
          }}
          error={error}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button color="orange" loading={isLoading} onClick={submit}>
            Pause
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Recurring check schedules (FRD 11); rules are Admin-only (SCH-001). */
export default function SchedulesPage() {
  const { can, me } = useSession();
  const [search, setSearch] = useState('');
  const [showEnded, setShowEnded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CheckSchedule | null>(null);
  const [pausing, setPausing] = useState<CheckSchedule | null>(null);
  const [act] = useScheduleActionMutation();
  const { data, isFetching, error } = useSchedulesQuery({
    includeArchived: showEnded,
  });
  const term = search.trim().toLowerCase();
  const rows = term
    ? data?.filter((item) =>
        [item.name, item.template.name, item.plant.assetId, item.plant.name]
          .join(' ')
          .toLowerCase()
          .includes(term),
      )
    : data;
  const tz = me?.organisation.timeZone;

  const columns: Column<CheckSchedule>[] = [
    {
      key: 'name',
      header: 'Schedule',
      render: (item) => (
        <Stack gap={0}>
          <Text fw={600} size="sm">
            {item.name}
          </Text>
          <Text size="xs" c="dimmed">
            {item.template.name} · {item.recurrence}
            {item.requiresApproval ? ' · needs approval' : ''}
          </Text>
        </Stack>
      ),
    },
    {
      key: 'plant',
      header: 'Plant',
      width: 160,
      render: (item) => (
        <Stack gap={0}>
          <Anchor component={Link} href={`/plant/${item.plant.id}?tab=checks`} size="sm" fw={600}>
            {item.plant.assetId}
          </Anchor>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {item.plant.name} · {item.plant.site.name}
          </Text>
        </Stack>
      ),
    },
    {
      key: 'next',
      header: 'Next check',
      width: 170,
      render: (item) =>
        item.openCheck ? (
          <Group gap={6} wrap="nowrap">
            <Anchor component={Link} href={`/checks/${item.openCheck.id}`} size="sm">
              {item.openCheck.ref}
            </Anchor>
            <CheckStatusBadge status={item.openCheck.status} />
          </Group>
        ) : (
          <Text size="sm">
            {item.state === 'active' ? `Due ${formatDate(item.nextDueOn, tz)}` : '—'}
          </Text>
        ),
    },
    {
      key: 'assignee',
      header: 'Assigned to',
      width: 140,
      render: (item) => (
        <Text size="sm" lineClamp={2}>
          {assigneeText(item.assignee)}
        </Text>
      ),
    },
    {
      key: 'state',
      header: 'State',
      width: 130,
      render: (item) => <ScheduleStateBadge state={item.state} />,
    },
    {
      key: 'actions',
      header: '',
      width: 56,
      render: (item) =>
        (item.capabilities.edit || item.capabilities.resume) && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button
                variant="subtle"
                px={6}
                aria-label={`Actions for ${item.name}`}
                onClick={(event) => event.stopPropagation()}
              >
                <IconDotsVertical size={16} />
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {item.capabilities.edit && (
                <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setEditing(item)}>
                  Edit
                </Menu.Item>
              )}
              {item.capabilities.pause && (
                <Menu.Item leftSection={<IconPlayerPause size={16} />} onClick={() => setPausing(item)}>
                  Pause
                </Menu.Item>
              )}
              {item.capabilities.resume && (
                <Menu.Item
                  leftSection={<IconPlayerPlay size={16} />}
                  onClick={() => act({ id: item.id, action: 'resume' })}
                >
                  Resume
                </Menu.Item>
              )}
              {item.capabilities.end && (
                <Menu.Item
                  color="red"
                  leftSection={<IconSquareX size={16} />}
                  onClick={() =>
                    confirmAction({
                      title: `End ${item.name}?`,
                      message:
                        'No more checks will be generated. Its history and earlier checks are kept.',
                      confirmLabel: 'End schedule',
                      danger: true,
                      onConfirm: async () => {
                        await act({ id: item.id, action: 'end' });
                      },
                    })
                  }
                >
                  End schedule
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
        title="Schedules"
        description="Recurring checks for each plant. A schedule pauses while its plant is out of service and resumes from the return-to-service date."
        actions={
          can('schedules.manage_rules') && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
              Add schedule
            </Button>
          )
        }
      />
      <TableCard
        toolbar={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search schedules" />
            <Switch
              label="Show ended"
              checked={showEnded}
              onChange={(event) => setShowEnded(event.currentTarget.checked)}
            />
          </>
        }
      >
        {error ? (
          <ErrorAlert error={error as ApiError} />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(item) => item.id}
            loading={isFetching}
            empty={
              <EmptyState
                title="No schedules yet"
                message="Add one to generate checks automatically, e.g. a daily pre-use check."
              />
            }
          />
        )}
      </TableCard>
      {creating && <NewScheduleModal opened onClose={() => setCreating(false)} />}
      {editing && <EditScheduleModal schedule={editing} onClose={() => setEditing(null)} />}
      {pausing && <PauseModal schedule={pausing} onClose={() => setPausing(null)} />}
      {data?.some((item) => item.state === 'plant_offline') && (
        <Alert mt="md" color="yellow" icon={<IconCalendarRepeat size={18} />}>
          Some schedules are paused because their plant is out of service. They
          resume by themselves when the plant returns to service.
        </Alert>
      )}
    </>
  );
}
