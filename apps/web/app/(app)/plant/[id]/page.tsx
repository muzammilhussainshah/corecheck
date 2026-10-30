'use client';

import {
  Alert,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Menu,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import {
  IconAlertTriangle,
  IconArchive,
  IconCalendar,
  IconCircleCheck,
  IconDotsVertical,
  IconHandStop,
  IconPencil,
  IconQrcode,
  IconRestore,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  type AuditEvent,
  auditActionLabel,
  type CustomField,
  type CustomValue,
  ERROR_CODES,
  PLANT_COMPANY_KIND_LABELS,
  PLANT_OWNERSHIP_LABELS,
  type PlantDetail,
  RESTRICTION_REASON_LABELS,
  RESTRICTION_REASONS,
  type RestrictionReason,
} from '@corecheck/shared';
import {
  type Column,
  confirmAction,
  DataTable,
  DEFAULT_PAGE_SIZE,
  DetailList,
  EmptyState,
  ErrorAlert,
  formatDate,
  formatDateTime,
  showApiErrors,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../../components/AppPageHeader';
import { ComplianceBadge } from '../../../../components/plant/DocumentBadges';
import { DocumentsTab } from '../../../../components/plant/DocumentsTab';
import { MetersTab } from '../../../../components/plant/MetersTab';
import { PlantStatusBadge } from '../../../../components/plant/PlantStatusBadge';
import { ReceptionTab } from '../../../../components/plant/ReceptionTab';
import {
  usePlantHistoryQuery,
  usePlantQuery,
  useRestrictPlantMutation,
  useReturnPlantToServiceMutation,
  useSetPlantArchivedMutation,
} from '../../../../lib/api';
import { useConfigList } from '../../../../lib/config';
import { downloadFile } from '../../../../lib/download';
import { useSession } from '../../../../lib/session';

const dash = (value: string | null | undefined) => value || '—';

/** A custom value as it reads on the profile. */
const showCustom = (
  field: CustomField,
  value: CustomValue | undefined,
  timeZone?: string,
) => {
  if (value === undefined || value === '') return '—';
  if (field.fieldType === 'date') return formatDate(String(value), timeZone);
  return String(value);
};

/** Takes plant out of use with a reason (PLC-002, PLC-005). */
function RestrictModal({
  plant,
  opened,
  onClose,
}: {
  plant: PlantDetail;
  opened: boolean;
  onClose: () => void;
}) {
  const [restrict, { isLoading }] = useRestrictPlantMutation();
  const form = useForm({
    initialValues: {
      reason: plant.restrictionReason as RestrictionReason | null,
      note: '',
    },
    validate: {
      note: (value) => (value.trim() ? null : 'Give the reason.'),
    },
  });
  const submit = form.onSubmit(async (values) => {
    const result = await restrict({ id: plant.id, ...values });
    if (result.error) return showApiErrors(form, result.error as ApiError);
    form.reset();
    onClose();
  });
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        plant.status === 'restricted' ? 'Update restriction' : 'Restrict plant'
      }
    >
      <form onSubmit={submit} noValidate>
        <Stack>
          <Text size="sm" c="dimmed">
            Restricted plant is Offline: it must not be used until it is
            returned to service.
          </Text>
          <Select
            label="Classification"
            placeholder="None"
            clearable
            data={RESTRICTION_REASONS.map((reason) => ({
              value: reason,
              label: RESTRICTION_REASON_LABELS[reason],
            }))}
            {...form.getInputProps('reason')}
          />
          <Textarea
            label="Reason"
            required
            autosize
            minRows={2}
            placeholder="What is wrong, or why it is out of use"
            {...form.getInputProps('note')}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button color="red" type="submit" loading={isLoading}>
              Restrict
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function ReturnModal({
  plant,
  opened,
  onClose,
}: {
  plant: PlantDetail;
  opened: boolean;
  onClose: () => void;
}) {
  const { can } = useSession();
  const [returnToService, { isLoading }] = useReturnPlantToServiceMutation();
  // Documents that stop it going Online, once the API has said so.
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const overriding = !!blockers && can('plant_status.override');
  const form = useForm({
    initialValues: { note: '', reviewOn: '' },
    validate: {
      note: (value) =>
        overriding && !value.trim()
          ? 'Give the reason for the override.'
          : null,
      reviewOn: (value) =>
        overriding && !value ? 'Choose the review date.' : null,
    },
  });
  const close = () => {
    setBlockers(null);
    form.reset();
    onClose();
  };
  const submit = form.onSubmit(async (values) => {
    const result = await returnToService({
      id: plant.id,
      note: values.note,
      ...(overriding && { override: true, reviewOn: values.reviewOn }),
    });
    if (result.error) {
      const error = result.error as ApiError;
      if (error.code === ERROR_CODES.DOCUMENTS_NOT_VALID)
        return setBlockers((error.details?.documents as string[]) ?? []);
      return showApiErrors(form, error);
    }
    close();
  });
  return (
    <Modal opened={opened} onClose={close} title="Return to service">
      <form onSubmit={submit} noValidate>
        <Stack>
          {blockers ? (
            <Alert
              color="red"
              icon={<IconAlertTriangle size={18} />}
              title="Mandatory documents are not valid"
            >
              <Text size="sm">{blockers.join(', ')}</Text>
              <Text size="sm" mt={4}>
                {overriding
                  ? 'You can override this until a review date. The missing documents stay on record.'
                  : 'Upload or verify them first, or ask a Manager or Admin to override.'}
              </Text>
            </Alert>
          ) : (
            <Text size="sm" c="dimmed">
              {plant.approvedAt
                ? 'The plant goes back Online and can be used again.'
                : 'This plant has not passed reception yet, so it returns to Pending Reception rather than Online.'}
            </Text>
          )}
          <Textarea
            label={overriding ? 'Reason for the override' : 'Note'}
            required={overriding}
            autosize
            minRows={2}
            placeholder={overriding ? undefined : 'Optional: what was done'}
            {...form.getInputProps('note')}
          />
          {overriding && (
            <DateInput
              label="Review by"
              description="The restriction applies again after this date unless the documents are valid."
              required
              valueFormat="D MMM YYYY"
              leftSection={<IconCalendar size={16} />}
              minDate={new Date()}
              value={form.values.reviewOn || null}
              onChange={(value) => form.setFieldValue('reviewOn', value ?? '')}
              error={form.errors.reviewOn}
            />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Cancel
            </Button>
            {(!blockers || overriding) && (
              <Button
                type="submit"
                color={overriding ? 'orange' : undefined}
                loading={isLoading}
              >
                {overriding ? 'Override and return' : 'Return to service'}
              </Button>
            )}
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** The plant's audit history, newest first (PLR-003). */
function HistoryTab({ plantId }: { plantId: string }) {
  const { me } = useSession();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const { data, isFetching, error } = usePlantHistoryQuery({
    id: plantId,
    page,
    pageSize,
  });
  const tz = me?.organisation.timeZone;
  const columns: Column<AuditEvent>[] = [
    {
      key: 'when',
      header: 'When',
      width: 180,
      render: (event) => (
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
          {formatDateTime(event.occurredAt, tz)}
        </Text>
      ),
    },
    {
      key: 'who',
      header: 'Who',
      width: 200,
      render: (event) => <Text size="sm">{event.actorName ?? 'System'}</Text>,
    },
    {
      key: 'what',
      header: 'What',
      render: (event) => (
        <Stack gap={0}>
          <Text size="sm" fw={600}>
            {auditActionLabel(event.action)}
          </Text>
          {typeof event.after?.note === 'string' && (
            <Text size="xs" c="dimmed">
              {event.after.note}
            </Text>
          )}
        </Stack>
      ),
    },
  ];
  if (error) return <ErrorAlert error={error as ApiError} />;
  return (
    <DataTable
      columns={columns}
      rows={data?.items}
      rowKey={(event) => event.id}
      loading={isFetching}
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
      empty={<EmptyState title="No history yet" />}
    />
  );
}

const ComingTab = ({ title, message }: { title: string; message: string }) => (
  <Card withBorder>
    <EmptyState title={title} message={message} />
  </Card>
);

const TABS = [
  'overview',
  'reception',
  'documents',
  'meters',
  'checks',
  'defects',
  'history',
];

export default function PlantProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // The open tab lives in the address, so links can open it (?tab=documents).
  const requested = useSearchParams().get('tab') ?? 'overview';
  const tab = TABS.includes(requested) ? requested : 'overview';
  const { me } = useSession();
  const { data: plant, error } = usePlantQuery(id);
  const { data: fields } = useConfigList('custom-fields', {
    includeArchived: true,
  });
  const [setArchived] = useSetPlantArchivedMutation();
  const [restricting, setRestricting] = useState(false);
  const [returning, setReturning] = useState(false);
  const [printing, setPrinting] = useState(false);
  const tz = me?.organisation.timeZone;

  if (error) return <ErrorAlert error={error as ApiError} />;
  if (!plant)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  const can = plant.capabilities;
  const archived = !!plant.archivedAt;
  // Fields with a value, plus every active field, in display order.
  const shownFields = (fields ?? []).filter(
    (field) => !field.archivedAt || plant.customValues[field.id] !== undefined,
  );

  const printLabel = async () => {
    setPrinting(true);
    await downloadFile(
      `/plants/qr-labels?ids=${plant.id}`,
      `${plant.assetId}-qr.pdf`,
    );
    setPrinting(false);
  };

  return (
    <>
      <AppPageHeader
        crumbs={[{ label: 'Plant', href: '/plant' }, { label: plant.assetId }]}
        title={
          <Group gap="sm">
            {plant.name}
            <PlantStatusBadge
              status={plant.status}
              archived={archived}
              reason={plant.restrictionReason}
            />
          </Group>
        }
        description={`${plant.assetId} · ${plant.plantType.name} · ${plant.site.name}`}
        actions={
          <>
            {can.edit && (
              <Button
                variant="default"
                leftSection={<IconPencil size={16} />}
                component={Link}
                href={`/plant/${plant.id}/edit`}
              >
                Edit
              </Button>
            )}
            {can.printQr && (
              <Button
                variant="default"
                leftSection={<IconQrcode size={16} />}
                onClick={printLabel}
                loading={printing}
              >
                QR label
              </Button>
            )}
            {can.returnToService && (
              <Button
                leftSection={<IconCircleCheck size={16} />}
                onClick={() => setReturning(true)}
              >
                Return to service
              </Button>
            )}
            {(can.restrict || can.archive) && (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <Button variant="default" px="xs" aria-label="More actions">
                    <IconDotsVertical size={18} />
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {can.restrict && (
                    <Menu.Item
                      color="red"
                      leftSection={<IconHandStop size={16} />}
                      onClick={() => setRestricting(true)}
                    >
                      {plant.status === 'restricted'
                        ? 'Update restriction'
                        : 'Restrict'}
                    </Menu.Item>
                  )}
                  {can.archive &&
                    (archived ? (
                      <Menu.Item
                        leftSection={<IconRestore size={16} />}
                        onClick={() =>
                          setArchived({ id: plant.id, archived: false })
                        }
                      >
                        Restore
                      </Menu.Item>
                    ) : (
                      <Menu.Item
                        leftSection={<IconArchive size={16} />}
                        onClick={() =>
                          confirmAction({
                            title: 'Archive plant?',
                            message: `${plant.assetId} leaves the register. Its records and history are kept and it can be restored.`,
                            confirmLabel: 'Archive',
                            danger: true,
                            onConfirm: async () => {
                              await setArchived({
                                id: plant.id,
                                archived: true,
                              });
                            },
                          })
                        }
                      >
                        Archive
                      </Menu.Item>
                    ))}
                </Menu.Dropdown>
              </Menu>
            )}
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={(value) =>
          router.replace(
            value === 'overview'
              ? `/plant/${plant.id}`
              : `/plant/${plant.id}?tab=${value}`,
            { scroll: false },
          )
        }
        keepMounted={false}
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="reception">Reception</Tabs.Tab>
          <Tabs.Tab value="documents">Documents</Tabs.Tab>
          <Tabs.Tab value="meters">Meter readings</Tabs.Tab>
          <Tabs.Tab value="checks">Checks</Tabs.Tab>
          <Tabs.Tab value="defects">Defects</Tabs.Tab>
          <Tabs.Tab value="history">History</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview">
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <Card withBorder>
              <Title order={4} mb="md">
                Details
              </Title>
              <DetailList
                items={[
                  { label: 'System Asset ID', value: plant.assetId },
                  { label: 'Plant Number', value: dash(plant.plantNumber) },
                  { label: 'Serial Number', value: dash(plant.serialNumber) },
                  { label: 'Plant type', value: plant.plantType.name },
                  { label: 'Category', value: dash(plant.category?.name) },
                  { label: 'Make', value: dash(plant.make) },
                  { label: 'Model', value: dash(plant.model) },
                  {
                    label: 'Disciplines',
                    value: dash(
                      plant.disciplines.map((item) => item.name).join(', '),
                    ),
                  },
                  ...shownFields.map((field) => ({
                    label: field.label,
                    value: showCustom(field, plant.customValues[field.id], tz),
                  })),
                ]}
              />
            </Card>
            <Stack>
              <Card withBorder>
                <Title order={4} mb="md">
                  Ownership and location
                </Title>
                <DetailList
                  items={[
                    {
                      label: 'Ownership',
                      value: PLANT_OWNERSHIP_LABELS[plant.ownership],
                    },
                    {
                      label:
                        PLANT_COMPANY_KIND_LABELS[
                          plant.ownership === 'owned' ? 'owner' : 'hire_company'
                        ],
                      value: plant.company.name,
                    },
                    { label: 'Site', value: plant.site.name },
                    { label: 'Area / location', value: dash(plant.area?.name) },
                  ]}
                />
              </Card>
              <Card withBorder>
                <Title order={4} mb="md">
                  Status
                </Title>
                <DetailList
                  items={[
                    {
                      label: 'Status',
                      value: (
                        <PlantStatusBadge
                          status={plant.status}
                          archived={archived}
                          reason={plant.restrictionReason}
                        />
                      ),
                    },
                    ...(plant.statusNote
                      ? [{ label: 'Reason', value: plant.statusNote }]
                      : []),
                    {
                      label: 'Documents',
                      value: <ComplianceBadge state={plant.compliance} />,
                    },
                    ...(plant.complianceOverride
                      ? [
                          {
                            label: 'Override',
                            value: `Until ${formatDate(plant.complianceOverride.until, tz)}: ${plant.complianceOverride.note}`,
                          },
                        ]
                      : []),
                    {
                      label: 'Last change',
                      value: `${formatDateTime(plant.statusChangedAt, tz)}${plant.statusChangedBy ? ` by ${plant.statusChangedBy}` : ''}`,
                    },
                    {
                      label: 'Registered',
                      value: `${formatDateTime(plant.createdAt, tz)} by ${plant.createdBy}`,
                    },
                    ...(archived
                      ? [
                          {
                            label: 'Archived',
                            value: formatDateTime(plant.archivedAt, tz),
                          },
                        ]
                      : []),
                  ]}
                />
              </Card>
            </Stack>
          </SimpleGrid>
        </Tabs.Panel>

        <Tabs.Panel value="reception">
          <ReceptionTab plant={plant} />
        </Tabs.Panel>
        <Tabs.Panel value="documents">
          <DocumentsTab plant={plant} />
        </Tabs.Panel>
        <Tabs.Panel value="meters">
          <MetersTab plant={plant} />
        </Tabs.Panel>
        <Tabs.Panel value="checks">
          <ComingTab
            title="No checks yet"
            message="Scheduled and completed checks arrive with templates and scheduling."
          />
        </Tabs.Panel>
        <Tabs.Panel value="defects">
          <ComingTab
            title="No defects"
            message="Defects raised by failed check answers arrive with the defects workflow."
          />
        </Tabs.Panel>
        <Tabs.Panel value="history">
          <Card
            withBorder
            p={0}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            <HistoryTab plantId={plant.id} />
          </Card>
        </Tabs.Panel>
      </Tabs>

      <RestrictModal
        plant={plant}
        opened={restricting}
        onClose={() => setRestricting(false)}
      />
      <ReturnModal
        plant={plant}
        opened={returning}
        onClose={() => setReturning(false)}
      />
    </>
  );
}
