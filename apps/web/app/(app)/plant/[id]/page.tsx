'use client';

import {
  Alert,
  Anchor,
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
import { PlantChecksTab } from '../../../../components/plant/PlantChecksTab';
import { PlantDefectsTab } from '../../../../components/plant/PlantDefectsTab';
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
  // Required plant information that is missing (PLT-008): no override.
  const [missingDetails, setMissingDetails] = useState<string[] | null>(null);
  // Open Defects that keep it Offline (DFW-009): an authorised override.
  const [defects, setDefects] = useState<PlantDetail['blockingDefects'] | null>(
    null,
  );
  // Any other refusal, shown here so the action never fails silently.
  const [failure, setFailure] = useState<ApiError | null>(null);
  // Refusals that trying again cannot change.
  const blocked =
    !!missingDetails ||
    failure?.code === ERROR_CODES.RECEPTION_APPROVAL_REQUIRED;
  const overriding = !!blockers && !blocked && can('plant_status.override');
  const overridingDefects =
    !!defects && !blocked && plant.capabilities.overrideDefects;
  const form = useForm({
    initialValues: { note: '', reviewOn: '' },
    validate: {
      note: (value) =>
        (overriding || overridingDefects) && !value.trim()
          ? 'Give the reason for the override.'
          : null,
      reviewOn: (value) =>
        overriding && !value ? 'Choose the review date.' : null,
    },
  });
  const close = () => {
    setBlockers(null);
    setDefects(null);
    setMissingDetails(null);
    setFailure(null);
    form.reset();
    onClose();
  };
  const submit = form.onSubmit(async (values) => {
    setFailure(null);
    const result = await returnToService({
      id: plant.id,
      note: values.note,
      ...(overriding && { override: true, reviewOn: values.reviewOn }),
      ...(overridingDefects && { overrideDefects: true }),
    });
    if (result.error) {
      const error = result.error as ApiError;
      if (error.code === ERROR_CODES.DEFECTS_OPEN)
        return setDefects(
          (error.details?.defects as PlantDetail['blockingDefects']) ?? [],
        );
      if (error.code === ERROR_CODES.PLANT_DETAILS_MISSING)
        return setMissingDetails(
          (error.details?.missingDetails as string[]) ?? [],
        );
      if (error.code === ERROR_CODES.DOCUMENTS_NOT_VALID)
        return setBlockers((error.details?.documents as string[]) ?? []);
      if (error.fieldErrors?.length) return showApiErrors(form, error);
      return setFailure(error);
    }
    close();
  });
  return (
    <Modal opened={opened} onClose={close} title="Return to service">
      <form onSubmit={submit} noValidate>
        <Stack>
          {defects && (
            <Alert
              color="red"
              icon={<IconAlertTriangle size={18} />}
              title="Open Defects keep this plant Restricted/Offline"
            >
              {defects.map((defect) => (
                <Text size="sm" key={defect.id}>
                  <Anchor component={Link} href={`/defects/${defect.id}`}>
                    {defect.ref}
                  </Anchor>{' '}
                  {defect.questionText}
                </Text>
              ))}
              <Text size="sm" mt={4}>
                {overridingDefects
                  ? 'You can override this with a reason. The Defects stay open and the override is kept in the audit.'
                  : 'Close them first, or ask a Manager or Admin to override.'}
              </Text>
            </Alert>
          )}
          {failure ? (
            <Alert
              color="red"
              icon={<IconAlertTriangle size={18} />}
              title={
                failure.code === ERROR_CODES.RECEPTION_APPROVAL_REQUIRED
                  ? 'This plant cannot be returned to service'
                  : 'The plant was not returned to service'
              }
            >
              <Text size="sm">{failure.message}</Text>
              {failure.requestId && failure.statusCode >= 500 && (
                <Text size="xs" c="dimmed" mt={4}>
                  Reference {failure.requestId.slice(0, 8)}
                </Text>
              )}
            </Alert>
          ) : missingDetails ? (
            <Alert
              color="red"
              icon={<IconAlertTriangle size={18} />}
              title="Required plant information is missing"
            >
              <Text size="sm">{missingDetails.join(', ')}</Text>
              <Text size="sm" mt={4}>
                Add it with Edit first. This cannot be overridden.
              </Text>
            </Alert>
          ) : blockers ? (
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
          ) : defects ? null : (
            <Text size="sm" c="dimmed">
              {plant.approvedAt
                ? 'The plant goes back Online and can be used again.'
                : 'This plant has not passed reception yet, so it returns to Pending Reception rather than Online.'}
            </Text>
          )}
          {!blocked && (
            <Textarea
              label={
                overriding || overridingDefects
                  ? 'Reason for the override'
                  : 'Note'
              }
              required={overriding || overridingDefects}
              autosize
              minRows={2}
              placeholder={
                overriding || overridingDefects
                  ? undefined
                  : 'Optional: what was done'
              }
              {...form.getInputProps('note')}
            />
          )}
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
            {!blocked &&
              (!blockers || overriding) &&
              (!defects || overridingDefects) && (
                <Button
                  type="submit"
                  color={overriding || overridingDefects ? 'orange' : undefined}
                  loading={isLoading}
                >
                  {overriding || overridingDefects
                    ? 'Override and return'
                    : 'Return to service'}
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

      {plant.blockingDefects.length > 0 && !archived && tab !== 'defects' && (
        <Alert
          mb="md"
          color="red"
          icon={<IconAlertTriangle size={18} />}
          title="Open Defects keep this plant Restricted/Offline"
        >
          {plant.blockingDefects.map((defect) => (
            <Text size="sm" key={defect.id}>
              <Anchor component={Link} href={`/defects/${defect.id}`}>
                {defect.ref}
              </Anchor>{' '}
              {defect.questionText}
            </Text>
          ))}
        </Alert>
      )}
      {plant.heldByReception && !archived && tab !== 'reception' && (
        // Why there is no Return to service: approving the reception, once
        // what it waits for is in order, is the way back (DOC-004, REC-AC-02).
        // The Reception tab says the same in its own box.
        <Alert
          mb="md"
          color="red"
          icon={<IconAlertTriangle size={18} />}
          title="Restricted/Offline until the reception is approved"
        >
          {/* What stops approval now, not when it was submitted (bug 8). */}
          {plant.receptionBlockers.map((blocker) => (
            <Text size="sm" key={blocker}>
              {blocker}
            </Text>
          ))}
          <Text size="sm" mt={4}>
            {plant.receptionBlockers.length
              ? 'Resolve these, then approve the reception.'
              : 'Its documents and details are now in order: approve the reception.'}{' '}
            <Anchor
              component={Link}
              href={`/plant/${plant.id}?tab=reception`}
              size="sm"
            >
              Open the Reception tab
            </Anchor>
          </Text>
        </Alert>
      )}

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
        <Tabs.List
          mb="md"
          style={{ flexWrap: 'nowrap', overflowX: 'auto', overflowY: 'hidden' }}
        >
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="reception">Reception</Tabs.Tab>
          <Tabs.Tab value="documents">Documents</Tabs.Tab>
          <Tabs.Tab value="meters">Meter readings</Tabs.Tab>
          <Tabs.Tab value="checks">Checks</Tabs.Tab>
          <Tabs.Tab value="defects">
            Defects{plant.openDefects ? ` (${plant.openDefects})` : ''}
          </Tabs.Tab>
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
                    // Held by its reception: why now, not why when it was
                    // submitted (bug 8); the original note is in History.
                    ...(plant.heldByReception
                      ? [
                          {
                            label: 'Reason',
                            value: plant.receptionBlockers.length
                              ? plant.receptionBlockers.join('; ')
                              : 'Waiting for the reception to be approved',
                          },
                        ]
                      : plant.statusNote
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
          <PlantChecksTab plant={plant} />
        </Tabs.Panel>
        <Tabs.Panel value="defects">
          <PlantDefectsTab plant={plant} />
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
