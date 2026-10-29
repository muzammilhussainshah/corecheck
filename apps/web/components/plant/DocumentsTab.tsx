'use client';

import {
  Alert,
  Anchor,
  Box,
  Button,
  Card,
  Center,
  Collapse,
  FileInput,
  Group,
  Loader,
  Menu,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import {
  IconArchive,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconDotsVertical,
  IconDownload,
  IconEye,
  IconFileUpload,
  IconRestore,
  IconShieldCheck,
  IconX,
} from '@tabler/icons-react';
import { useState } from 'react';
import {
  type ApiError,
  MAX_DOCUMENT_BYTES,
  type PlantDetail,
  type PlantDocument,
} from '@corecheck/shared';
import {
  COLORS,
  EmptyState,
  ErrorAlert,
  formatBytes,
  formatDate,
  formatDateTime,
  showApiErrors,
} from '@corecheck/ui';
import {
  useDocumentActionMutation,
  usePlantDocumentsQuery,
  useReplaceDocumentMutation,
  useUploadDocumentMutation,
} from '../../lib/api';
import { useConfigList } from '../../lib/config';
import { downloadFile, openFile } from '../../lib/download';
import { useSession } from '../../lib/session';
import { ComplianceBadge, DocumentStateBadge } from './DocumentBadges';

const fileUrl = (document: PlantDocument, versionId: string) =>
  `/documents/${document.id}/versions/${versionId}/file`;

interface UploadValues {
  documentTypeId: string;
  reference: string;
  issuedOn: string;
  expiresOn: string;
  file: File | null;
}

/** Uploads a document, or a new version of one (DOC-002, DOC-007). */
function UploadModal({
  plantId,
  replacing,
  defaultTypeId,
  opened,
  onClose,
}: {
  plantId: string;
  replacing: PlantDocument | null;
  defaultTypeId: string | null;
  opened: boolean;
  onClose: () => void;
}) {
  const { data: types } = useConfigList('document-types');
  const [upload, uploading] = useUploadDocumentMutation();
  const [replace, replacingState] = useReplaceDocumentMutation();
  const form = useForm<UploadValues>({
    initialValues: {
      documentTypeId: defaultTypeId ?? '',
      reference: '',
      issuedOn: '',
      expiresOn: '',
      file: null,
    },
    validate: {
      documentTypeId: (value) =>
        replacing || value ? null : 'Choose the document type.',
      file: (value) =>
        !value
          ? 'Choose a file.'
          : value.size > MAX_DOCUMENT_BYTES
            ? 'The file is larger than 20 MB.'
            : null,
      expiresOn: (value, values) =>
        needsExpiry(values.documentTypeId) && !value
          ? 'This document type needs an expiry date.'
          : values.issuedOn && value && value < values.issuedOn
            ? 'The expiry date must be on or after the issue date.'
            : null,
    },
  });
  const typeOf = (id: string) => types?.find((type) => type.id === id);
  const needsExpiry = (id: string) =>
    replacing ? replacing.documentType.hasExpiry : !!typeOf(id)?.hasExpiry;

  const submit = form.onSubmit(async (values) => {
    const body = new FormData();
    if (!replacing) body.append('documentTypeId', values.documentTypeId);
    for (const key of ['reference', 'issuedOn', 'expiresOn'] as const)
      if (values[key]) body.append(key, values[key]);
    body.append('file', values.file!);
    const result = replacing
      ? await replace({ documentId: replacing.id, form: body })
      : await upload({ plantId, form: body });
    if (result.error) return showApiErrors(form, result.error as ApiError);
    form.reset();
    onClose();
  });

  const date = (key: 'issuedOn' | 'expiresOn', label: string) => (
    <DateInput
      label={label}
      valueFormat="D MMM YYYY"
      leftSection={<IconCalendar size={16} />}
      clearable
      required={key === 'expiresOn' && needsExpiry(form.values.documentTypeId)}
      value={form.values[key] || null}
      onChange={(value) => form.setFieldValue(key, value ?? '')}
      error={form.errors[key]}
    />
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        replacing
          ? `New version of ${replacing.documentType.name}`
          : 'Upload document'
      }
      size="lg"
    >
      <form onSubmit={submit} noValidate>
        <Stack>
          {replacing && (
            <Text size="sm" c="dimmed">
              The current file and its verification are kept in the history. The
              new version needs verifying.
            </Text>
          )}
          {!replacing && (
            <Select
              label="Document type"
              placeholder="Select type"
              required
              searchable
              data={(types ?? []).map((type) => ({
                value: type.id,
                label: type.name,
              }))}
              nothingFoundMessage="Add document types under Manage › Document types"
              value={form.values.documentTypeId || null}
              onChange={(value) =>
                form.setFieldValue('documentTypeId', value ?? '')
              }
              error={form.errors.documentTypeId}
            />
          )}
          <TextInput
            label="Reference"
            placeholder="Certificate or policy number"
            {...form.getInputProps('reference')}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {date('issuedOn', 'Issue date')}
            {date('expiresOn', 'Expiry date')}
          </SimpleGrid>
          <FileInput
            label="File"
            description="PDF, JPEG or PNG, up to 20 MB."
            placeholder="Choose file"
            required
            accept="application/pdf,image/jpeg,image/png"
            clearable
            {...form.getInputProps('file')}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              leftSection={<IconFileUpload size={16} />}
              loading={uploading.isLoading || replacingState.isLoading}
            >
              Upload
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function RejectModal({
  document,
  onClose,
}: {
  document: PlantDocument | null;
  onClose: () => void;
}) {
  const [act, { isLoading }] = useDocumentActionMutation();
  const form = useForm({
    initialValues: { reason: '' },
    validate: { reason: (value) => (value.trim() ? null : 'Give the reason.') },
  });
  const submit = form.onSubmit(async ({ reason }) => {
    if (!document) return;
    const result = await act({
      documentId: document.id,
      action: 'reject',
      reason,
    });
    if (result.error) return showApiErrors(form, result.error as ApiError);
    form.reset();
    onClose();
  });
  return (
    <Modal
      opened={!!document}
      onClose={onClose}
      title={document ? `Reject ${document.documentType.name}` : ''}
    >
      <form onSubmit={submit} noValidate>
        <Stack>
          <Text size="sm" c="dimmed">
            A rejected document does not count towards the plant&apos;s
            mandatory documents. Someone can upload a new version.
          </Text>
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
            <Button color="red" type="submit" loading={isLoading}>
              Reject
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

const verificationText = (
  version: PlantDocument['versions'][number],
  tz?: string,
) =>
  version.verification === 'verified'
    ? `Verified by ${version.verifiedBy ?? 'unknown'} on ${formatDate(version.verifiedAt, tz)}`
    : version.verification === 'rejected'
      ? `Rejected by ${version.verifiedBy ?? 'unknown'}: ${version.rejectionReason ?? ''}`
      : 'Awaiting verification';

function DocumentCard({
  document,
  onReplace,
  onReject,
}: {
  document: PlantDocument;
  onReplace: () => void;
  onReject: () => void;
}) {
  const { me } = useSession();
  const tz = me?.organisation.timeZone;
  const [act] = useDocumentActionMutation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const current = document.versions[0]!;
  const older = document.versions.slice(1);
  const can = document.capabilities;
  const archived = !!document.archivedAt;

  return (
    <Card withBorder padding="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Group gap="sm">
            <Text fw={600} c={COLORS.title}>
              {document.documentType.name}
            </Text>
            <DocumentStateBadge state={document.state} />
          </Group>
          <Text size="sm" c={COLORS.muted}>
            {[
              current.reference && `Ref. ${current.reference}`,
              current.issuedOn && `Issued ${formatDate(current.issuedOn, tz)}`,
              current.expiresOn
                ? `Expires ${formatDate(current.expiresOn, tz)}`
                : document.documentType.hasExpiry
                  ? null
                  : 'Does not expire',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Text size="xs" c={COLORS.muted}>
            Version {current.version} · {current.fileName} (
            {formatBytes(current.sizeBytes)}) · uploaded by {current.uploadedBy}{' '}
            on {formatDateTime(current.uploadedAt, tz)}
          </Text>
          <Text
            size="xs"
            c={current.verification === 'rejected' ? 'red.7' : COLORS.muted}
          >
            {verificationText(current, tz)}
          </Text>
        </Stack>
        <Group gap="xs" wrap="nowrap">
          <Button
            variant="default"
            size="xs"
            leftSection={<IconEye size={14} />}
            onClick={() => openFile(fileUrl(document, current.id))}
          >
            View
          </Button>
          {can.verify && !archived && current.verification === 'awaiting' && (
            <Button
              size="xs"
              leftSection={<IconCheck size={14} />}
              onClick={() => act({ documentId: document.id, action: 'verify' })}
            >
              Verify
            </Button>
          )}
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button
                variant="default"
                size="xs"
                px={6}
                aria-label={`More for ${document.documentType.name}`}
              >
                <IconDotsVertical size={16} />
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconDownload size={14} />}
                onClick={() =>
                  downloadFile(fileUrl(document, current.id), current.fileName)
                }
              >
                Download
              </Menu.Item>
              {can.replace && (
                <Menu.Item
                  leftSection={<IconFileUpload size={14} />}
                  onClick={onReplace}
                >
                  Upload new version
                </Menu.Item>
              )}
              {can.verify && !archived && (
                <Menu.Item
                  color="red"
                  leftSection={<IconX size={14} />}
                  onClick={onReject}
                >
                  Reject
                </Menu.Item>
              )}
              {can.archive &&
                (archived ? (
                  <Menu.Item
                    leftSection={<IconRestore size={14} />}
                    onClick={() =>
                      act({ documentId: document.id, action: 'restore' })
                    }
                  >
                    Restore
                  </Menu.Item>
                ) : (
                  <Menu.Item
                    leftSection={<IconArchive size={14} />}
                    onClick={() =>
                      act({ documentId: document.id, action: 'archive' })
                    }
                  >
                    Archive
                  </Menu.Item>
                ))}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      {older.length > 0 && (
        <Box mt="sm">
          <Anchor
            component="button"
            type="button"
            size="sm"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <Group gap={4}>
              Earlier versions ({older.length})
              <IconChevronDown
                size={14}
                style={{
                  transform: historyOpen ? 'rotate(180deg)' : undefined,
                }}
              />
            </Group>
          </Anchor>
          <Collapse expanded={historyOpen}>
            <Stack gap={6} mt="xs">
              {older.map((version) => (
                <Group key={version.id} gap="sm" wrap="nowrap">
                  <Text size="xs" fw={600} w={70}>
                    Version {version.version}
                  </Text>
                  <Text size="xs" c={COLORS.muted} style={{ flex: 1 }}>
                    {version.fileName} ·{' '}
                    {formatDateTime(version.uploadedAt, tz)} by{' '}
                    {version.uploadedBy} · {verificationText(version, tz)}
                  </Text>
                  <Anchor
                    component="button"
                    type="button"
                    size="xs"
                    onClick={() => openFile(fileUrl(document, version.id))}
                  >
                    View
                  </Anchor>
                </Group>
              ))}
            </Stack>
          </Collapse>
        </Box>
      )}
    </Card>
  );
}

/** A plant's documents and how it stands on its mandatory ones (FRD 9). */
export function DocumentsTab({ plant }: { plant: PlantDetail }) {
  const { me } = useSession();
  const tz = me?.organisation.timeZone;
  const { data, error, isLoading } = usePlantDocumentsQuery(plant.id);
  const [uploading, setUploading] = useState<{
    replacing: PlantDocument | null;
    typeId: string | null;
  } | null>(null);
  const [rejecting, setRejecting] = useState<PlantDocument | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (error) return <ErrorAlert error={error as ApiError} />;
  if (isLoading || !data)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  const { compliance, capabilities } = data;
  const documents = data.documents.filter(
    (document) => showArchived || !document.archivedAt,
  );
  const missing = compliance.requirements.filter(
    (item) => item.state === 'missing',
  );

  return (
    <Stack>
      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Title order={4}>Mandatory documents</Title>
          <ComplianceBadge state={compliance.state} />
        </Group>
        {compliance.requirements.length === 0 ? (
          <Text size="sm" c={COLORS.muted}>
            {plant.plantType.name} has no mandatory documents. Choose them under
            Manage › Plant types.
          </Text>
        ) : (
          <Stack gap="xs">
            {compliance.requirements.map((item) => (
              <Group key={item.documentType.id} justify="space-between">
                <Text size="sm">{item.documentType.name}</Text>
                <Group gap="xs">
                  <DocumentStateBadge state={item.state} />
                  {item.state === 'missing' && capabilities.upload && (
                    <Button
                      size="compact-xs"
                      variant="light"
                      onClick={() =>
                        setUploading({
                          replacing: null,
                          typeId: item.documentType.id,
                        })
                      }
                    >
                      Upload
                    </Button>
                  )}
                </Group>
              </Group>
            ))}
            {compliance.state === 'non_compliant' && (
              <Text size="xs" c={COLORS.muted} mt={4}>
                Until each one is valid and verified, this plant cannot be
                approved and is kept Restricted/Offline.
              </Text>
            )}
          </Stack>
        )}
        {compliance.override && (
          <Alert
            mt="md"
            color="yellow"
            icon={<IconShieldCheck size={18} />}
            title={`Override until ${formatDate(compliance.override.until, tz)}`}
          >
            <Text size="sm">
              {compliance.override.note}
              {compliance.override.by && ` — ${compliance.override.by}`}
            </Text>
          </Alert>
        )}
      </Card>

      <Group justify="space-between">
        <Title order={4}>Documents</Title>
        <Group gap="md">
          <Switch
            label="Show archived"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.currentTarget.checked)}
          />
          {capabilities.upload && (
            <Button
              leftSection={<IconFileUpload size={16} />}
              onClick={() => setUploading({ replacing: null, typeId: null })}
            >
              Upload document
            </Button>
          )}
        </Group>
      </Group>

      {documents.length === 0 ? (
        <Card withBorder>
          <EmptyState
            title="No documents yet"
            message={
              missing.length
                ? `This plant still needs: ${missing.map((m) => m.documentType.name).join(', ')}.`
                : 'Upload certificates, inspections and insurance for this plant.'
            }
          />
        </Card>
      ) : (
        documents.map((document) => (
          <DocumentCard
            key={document.id}
            document={document}
            onReplace={() =>
              setUploading({ replacing: document, typeId: null })
            }
            onReject={() => setRejecting(document)}
          />
        ))
      )}

      {uploading && (
        <UploadModal
          plantId={plant.id}
          replacing={uploading.replacing}
          defaultTypeId={uploading.typeId}
          opened
          onClose={() => setUploading(null)}
        />
      )}
      <RejectModal document={rejecting} onClose={() => setRejecting(null)} />
    </Stack>
  );
}
