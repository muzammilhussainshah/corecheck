'use client';

import {
  Alert,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertTriangle, IconPlus } from '@tabler/icons-react';
import { useState } from 'react';
import type { ApiError, MeterReading, PlantDetail } from '@corecheck/shared';
import {
  type Column,
  COLORS,
  DataTable,
  EmptyState,
  ErrorAlert,
  formatDateTime,
  showApiErrors,
} from '@corecheck/ui';
import {
  useCorrectMeterReadingMutation,
  usePlantMetersQuery,
  useRecordMeterReadingMutation,
} from '../../lib/api';
import { useConfigList } from '../../lib/config';
import { useSession } from '../../lib/session';

/**
 * A reading is checked as entered and never changed for the user: Mantine's
 * NumberInput would otherwise clamp -1 to 0 on blur and a false zero would be
 * saved (Milestone 2 bug 2).
 */
const readingError = (value: number | '', empty: string): string | null =>
  value === '' ? empty : value < 0 ? 'A reading cannot be negative.' : null;

/** Below the meter's latest reading: a replaced or reset meter. */
const isLower = (value: number | '', latest: MeterReading | undefined) =>
  value !== '' && value >= 0 && !!latest && value < latest.value;

/**
 * A reading below the latest needs a reason, kept with it and in the audit
 * (Milestone 2 bug 7); the API refuses one without.
 */
function LowerThanLatestWarning({ latest }: { latest: MeterReading }) {
  return (
    <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
      This is lower than the latest {latest.meterType.name} reading of{' '}
      {latest.value} {latest.unit}. Check the value. If the meter was replaced
      or reset, give the reason below; it is kept with the reading.
    </Alert>
  );
}

function RecordModal({
  plantId,
  latest,
  opened,
  onClose,
}: {
  plantId: string;
  latest: MeterReading[];
  opened: boolean;
  onClose: () => void;
}) {
  const { data: meters } = useConfigList('meter-types');
  const [record, { isLoading }] = useRecordMeterReadingMutation();
  const latestOf = (meterTypeId: string) =>
    latest.find((reading) => reading.meterType.id === meterTypeId);
  const form = useForm<{
    meterTypeId: string;
    value: number | '';
    resetReason: string;
  }>({
    initialValues: { meterTypeId: '', value: '', resetReason: '' },
    validate: {
      meterTypeId: (value) => (value ? null : 'Choose the meter.'),
      value: (value) => readingError(value, 'Enter the reading.'),
      resetReason: (value, values) =>
        isLower(values.value, latestOf(values.meterTypeId)) && !value.trim()
          ? 'Give the reason the reading is lower, e.g. the meter was replaced.'
          : null,
    },
  });
  const latestForMeter = latestOf(form.values.meterTypeId);
  const lower = isLower(form.values.value, latestForMeter);
  const submit = form.onSubmit(async (values) => {
    const result = await record({
      plantId,
      meterTypeId: values.meterTypeId,
      value: values.value as number,
      ...(lower && { resetReason: values.resetReason }),
    });
    if (result.error) return showApiErrors(form, result.error as ApiError);
    form.reset();
    onClose();
  });
  return (
    <Modal opened={opened} onClose={onClose} title="Record meter reading">
      <form onSubmit={submit} noValidate>
        <Stack>
          <Select
            label="Meter"
            required
            data={(meters ?? []).map((meter) => ({
              value: meter.id,
              label: `${meter.name} (${meter.unit})`,
            }))}
            nothingFoundMessage="Add meter types under Manage › Meter types"
            value={form.values.meterTypeId || null}
            onChange={(value) => form.setFieldValue('meterTypeId', value ?? '')}
            error={form.errors.meterTypeId}
          />
          <NumberInput
            label="Reading"
            required
            min={0}
            clampBehavior="none"
            {...form.getInputProps('value')}
          />
          {lower && latestForMeter && (
            <>
              <LowerThanLatestWarning latest={latestForMeter} />
              <Textarea
                label="Reason for the lower reading"
                placeholder="e.g. Hour meter replaced on 20 Nov"
                required
                autosize
                minRows={2}
                {...form.getInputProps('resetReason')}
              />
            </>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={isLoading}>
              Save reading
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function CorrectModal({
  reading,
  onClose,
}: {
  reading: MeterReading;
  onClose: () => void;
}) {
  const [correct, { isLoading }] = useCorrectMeterReadingMutation();
  const form = useForm<{ value: number | ''; reason: string }>({
    initialValues: { value: reading.value, reason: '' },
    validate: {
      value: (value) => readingError(value, 'Enter the correct reading.'),
      reason: (value) => (value.trim() ? null : 'Give the reason.'),
    },
  });
  const submit = form.onSubmit(async (values) => {
    const result = await correct({
      id: reading.id,
      value: values.value as number,
      reason: values.reason,
    });
    if (result.error) return showApiErrors(form, result.error as ApiError);
    onClose();
  });
  return (
    <Modal opened onClose={onClose} title="Correct reading">
      <form onSubmit={submit} noValidate>
        <Stack>
          <Text size="sm" c="dimmed">
            The original value stays in the history.
          </Text>
          <NumberInput
            label={`Correct value (${reading.unit})`}
            required
            min={0}
            clampBehavior="none"
            {...form.getInputProps('value')}
          />
          <Textarea
            label="Reason"
            required
            autosize
            minRows={2}
            {...form.getInputProps('reason')}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={isLoading}>
              Save correction
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** A plant's meter readings in date order (MTR-006). */
export function MetersTab({ plant }: { plant: PlantDetail }) {
  const { me } = useSession();
  const tz = me?.organisation.timeZone;
  const { data, error, isFetching } = usePlantMetersQuery(plant.id);
  const [recording, setRecording] = useState(false);
  const [correcting, setCorrecting] = useState<MeterReading | null>(null);

  if (error) return <ErrorAlert error={error as ApiError} />;
  if (!data)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  const columns: Column<MeterReading>[] = [
    {
      key: 'when',
      header: 'Read at',
      width: 180,
      render: (reading) => (
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
          {formatDateTime(reading.readAt, tz)}
        </Text>
      ),
    },
    {
      key: 'meter',
      header: 'Meter',
      render: (reading) => <Text size="sm">{reading.meterType.name}</Text>,
    },
    {
      key: 'value',
      header: 'Reading',
      render: (reading) => (
        <Stack gap={0}>
          <Text size="sm" fw={600}>
            {reading.value} {reading.unit}
          </Text>
          {reading.resetReason && (
            <Text size="xs" c="orange.8">
              Lower than the reading before: {reading.resetReason}
            </Text>
          )}
          {reading.corrections.map((item) => (
            <Text size="xs" c={COLORS.muted} key={item.correctedAt}>
              Was {item.previousValue}: {item.reason} ({item.correctedBy},{' '}
              {formatDateTime(item.correctedAt, tz)})
            </Text>
          ))}
        </Stack>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      width: 120,
      render: (reading) => (
        <Text size="sm">
          {reading.source === 'reception' ? 'Reception' : 'Manual'}
        </Text>
      ),
    },
    {
      key: 'by',
      header: 'Recorded by',
      render: (reading) => <Text size="sm">{reading.recordedBy}</Text>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: 100,
      render: (reading) =>
        reading.canCorrect && (
          <Button
            variant="subtle"
            size="compact-sm"
            onClick={() => setCorrecting(reading)}
          >
            Correct
          </Button>
        ),
    },
  ];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={4}>Latest readings</Title>
        {data.capabilities.record && (
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => setRecording(true)}
          >
            Record reading
          </Button>
        )}
      </Group>
      {data.latest.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          {data.latest.map((reading) => (
            <Card withBorder key={reading.id}>
              <Text size="sm" c={COLORS.muted}>
                {reading.meterType.name}
              </Text>
              <Text fw={600} fz={22} c={COLORS.title}>
                {reading.value} {reading.unit}
              </Text>
              <Text size="xs" c={COLORS.muted}>
                {formatDateTime(reading.readAt, tz)}
              </Text>
            </Card>
          ))}
        </SimpleGrid>
      )}
      <Card
        withBorder
        p={0}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        <DataTable
          columns={columns}
          rows={data.readings}
          rowKey={(reading) => reading.id}
          loading={isFetching}
          empty={
            <EmptyState
              title="No meter readings yet"
              message="Readings recorded by hand or during reception appear here."
            />
          }
        />
      </Card>
      <RecordModal
        plantId={plant.id}
        latest={data.latest}
        opened={recording}
        onClose={() => setRecording(false)}
      />
      {correcting && (
        <CorrectModal
          key={correcting.id}
          reading={correcting}
          onClose={() => setCorrecting(null)}
        />
      )}
    </Stack>
  );
}
