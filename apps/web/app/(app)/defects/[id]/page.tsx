'use client';

import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  FileButton,
  Group,
  Loader,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconPaperclip,
  IconPlayerPlay,
  IconX,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  auditActionLabel,
  DEFECT_SEVERITIES,
  DEFECT_SEVERITY_LABELS,
  type DefectDetail,
  type DefectSeverity,
} from '@corecheck/shared';
import {
  COLORS,
  DetailList,
  ErrorAlert,
  formatDateTime,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../../components/AppPageHeader';
import { showValue } from '../../../../components/checks/AnswerInput';
import {
  CheckStatusBadge,
  DefectStatusBadge,
  SeverityBadge,
  VerificationBadge,
} from '../../../../components/checks/badges';
import {
  useAddDefectEvidenceMutation,
  useAssignDefectMutation,
  useDefectActionMutation,
  useDefectQuery,
  useRecordDefectWorkMutation,
  useRemoveDefectEvidenceMutation,
  useUsersQuery,
} from '../../../../lib/api';
import { openFile } from '../../../../lib/download';
import { useSession } from '../../../../lib/session';

const message = (error: unknown) => {
  const failure = error as ApiError;
  return failure.fieldErrors?.map((item) => item.message).join(' ') || failure.message;
};

/** Classify and assign (Appendix C). */
function AssignCard({ defect }: { defect: DefectDetail }) {
  const { data: users } = useUsersQuery({ page: 1, pageSize: 100, status: 'active' });
  const [assign, { isLoading }] = useAssignDefectMutation();
  const [assignee, setAssignee] = useState<string | null>(defect.assignee?.id ?? null);
  const [severity, setSeverity] = useState<DefectSeverity>(defect.severity);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card withBorder>
      <Title order={4} mb="sm">
        Classify and assign
      </Title>
      <Group align="flex-end">
        <Select
          label="Severity"
          allowDeselect={false}
          w={160}
          data={DEFECT_SEVERITIES.map((value) => ({ value, label: DEFECT_SEVERITY_LABELS[value] }))}
          value={severity}
          onChange={(value) => setSeverity(value as DefectSeverity)}
        />
        <Select
          label="Assigned to"
          placeholder="Unassigned"
          searchable
          clearable
          style={{ flex: 1 }}
          maw={320}
          data={(users?.items ?? []).map((user) => ({
            value: user.id,
            label: `${user.firstName} ${user.lastName}`,
          }))}
          value={assignee}
          onChange={setAssignee}
          error={error}
        />
        <Button
          loading={isLoading}
          onClick={async () => {
            setError(null);
            const result = await assign({ id: defect.id, severity, assigneeUserId: assignee });
            if (result.error) setError(message(result.error));
          }}
        >
          Save
        </Button>
      </Group>
    </Card>
  );
}

/** Corrective action, repair notes and evidence (DFW-002, DFW-003). */
function WorkCard({ defect }: { defect: DefectDetail }) {
  const { me } = useSession();
  const tz = me?.organisation.timeZone;
  const [record, { isLoading }] = useRecordDefectWorkMutation();
  const [addEvidence, adding] = useAddDefectEvidenceMutation();
  const [removeEvidence] = useRemoveDefectEvidenceMutation();
  const [action, setAction] = useState(defect.correctiveAction ?? '');
  const [notes, setNotes] = useState(defect.repairNotes ?? '');
  const [error, setError] = useState<string | null>(null);
  const can = defect.capabilities.recordWork;
  return (
    <Card withBorder>
      <Title order={4} mb="sm">
        Corrective work
      </Title>
      <Stack>
        <Textarea
          label="Corrective action"
          required={defect.requireCorrectiveAction}
          autosize
          minRows={2}
          disabled={!can}
          value={action}
          onChange={(event) => setAction(event.currentTarget.value)}
        />
        <Textarea
          label="Repair notes"
          autosize
          minRows={2}
          disabled={!can}
          value={notes}
          onChange={(event) => setNotes(event.currentTarget.value)}
          error={error}
        />
        {defect.workRecordedBy && (
          <Text size="xs" c={COLORS.muted}>
            Last recorded by {defect.workRecordedBy} on {formatDateTime(defect.workRecordedAt, tz)}
          </Text>
        )}
        <Text size="sm" fw={500}>
          Repair evidence{defect.requireRepairEvidence ? ' (required)' : ''}
        </Text>
        {defect.evidence.length === 0 && (
          <Text size="sm" c="dimmed">
            None yet.
          </Text>
        )}
        {defect.evidence.map((file) => (
          <Group gap={6} key={file.id}>
            <Anchor component="button" type="button" size="sm" onClick={() => openFile(`/defects/${defect.id}/evidence/${file.id}/file`)}>
              {file.fileName}
            </Anchor>
            <Text size="xs" c={COLORS.muted}>
              {file.uploadedBy}, {formatDateTime(file.uploadedAt, tz)}
            </Text>
            {can && (
              <Anchor component="button" type="button" c="red" aria-label={`Remove ${file.fileName}`} onClick={() => removeEvidence({ id: defect.id, evidenceId: file.id })}>
                <IconX size={14} />
              </Anchor>
            )}
          </Group>
        ))}
        {can && (
          <Group justify="space-between">
            <FileButton
              accept="image/jpeg,image/png,application/pdf"
              onChange={(file) => {
                if (!file) return;
                const form = new FormData();
                form.append('file', file);
                void addEvidence({ id: defect.id, form }).then((result) => {
                  if (result.error) setError(message(result.error));
                });
              }}
            >
              {(props) => (
                <Button {...props} variant="default" size="xs" leftSection={<IconPaperclip size={14} />} loading={adding.isLoading}>
                  Add photo or file
                </Button>
              )}
            </FileButton>
            <Button
              loading={isLoading}
              onClick={async () => {
                setError(null);
                const result = await record({ id: defect.id, correctiveAction: action, repairNotes: notes });
                if (result.error) setError(message(result.error));
              }}
            >
              Save work
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}

/** Starts the shorter verification check (DFW-004). */
function VerificationCard({ defect }: { defect: DefectDetail }) {
  const [act, { isLoading }] = useDefectActionMutation();
  const [templateId, setTemplateId] = useState<string | null>(
    defect.verificationTemplates.length === 1 ? defect.verificationTemplates[0]!.id : null,
  );
  const [error, setError] = useState<string | null>(null);
  const check = defect.verificationCheck;
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={4}>Verification</Title>
        <VerificationBadge state={defect.verification} />
      </Group>
      {check && (
        <Group gap="sm" mb="sm">
          <Anchor component={Link} href={`/checks/${check.id}`} fw={600}>
            {check.ref} {check.template.name}
          </Anchor>
          <CheckStatusBadge status={check.displayStatus} />
        </Group>
      )}
      {defect.capabilities.startVerification ? (
        <Group align="flex-end">
          <Select
            label="Verification template"
            allowDeselect={false}
            style={{ flex: 1 }}
            maw={360}
            data={defect.verificationTemplates.map((item) => ({ value: item.id, label: item.name }))}
            value={templateId}
            onChange={setTemplateId}
            error={error}
          />
          <Button
            disabled={!templateId}
            loading={isLoading}
            onClick={async () => {
              setError(null);
              const result = await act({ id: defect.id, action: 'verification', body: { templateId } });
              if (result.error) setError(message(result.error));
            }}
          >
            Start verification
          </Button>
        </Group>
      ) : (
        defect.status === 'in_progress' &&
        defect.verification === 'not_started' &&
        defect.verificationTemplates.length === 0 && (
          <Text size="sm" c="dimmed">
            No published Defect verification template applies to this plant. An Admin adds one under Manage › Templates.
          </Text>
        )
      )}
      {!check && defect.status === 'open' && (
        <Text size="sm" c="dimmed">
          Move the Defect to In Progress to verify it.
        </Text>
      )}
    </Card>
  );
}

function ReasonModal({
  title,
  label,
  required,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  label: string;
  required: boolean;
  confirm: string;
  onConfirm: (text: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal opened onClose={onClose} title={title}>
      <Stack>
        <Textarea label={label} required={required} autosize minRows={2} value={text} onChange={(event) => setText(event.currentTarget.value)} error={error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Back
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              if (required && !text.trim()) return setError('Give the reason.');
              setBusy(true);
              const failure = await onConfirm(text);
              setBusy(false);
              if (failure) setError(failure);
              else onClose();
            }}
          >
            {confirm}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function DefectPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const tz = me?.organisation.timeZone;
  const { data: defect, error } = useDefectQuery(id);
  const [act, acting] = useDefectActionMutation();
  const [modal, setModal] = useState<null | 'close' | 'reopen'>(null);
  const [failure, setFailure] = useState<string | null>(null);
  if (error) return <ErrorAlert error={error as ApiError} />;
  if (!defect)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  const can = defect.capabilities;
  const closeWith = async (note: string) => {
    const result = await act({ id: defect.id, action: 'close', body: { note: note || undefined } });
    return result.error ? message(result.error) : null;
  };
  const reopenWith = async (reason: string) => {
    const result = await act({ id: defect.id, action: 'reopen', body: { reason } });
    return result.error ? message(result.error) : null;
  };
  return (
    <>
      <AppPageHeader
        crumbs={[{ label: 'Defects', href: '/defects' }, { label: defect.ref }]}
        title={
          <Group gap="sm">
            {defect.ref}
            <SeverityBadge severity={defect.severity} />
            <DefectStatusBadge status={defect.status} />
          </Group>
        }
        description={`${defect.questionText} · ${defect.plant.assetId} ${defect.plant.name}`}
        actions={
          <>
            {can.start && (
              <Button
                leftSection={<IconPlayerPlay size={16} />}
                loading={acting.isLoading}
                onClick={async () => {
                  const result = await act({ id: defect.id, action: 'start' });
                  setFailure(result.error ? message(result.error) : null);
                }}
              >
                Move to In Progress
              </Button>
            )}
            {defect.status !== 'closed' && (
              <Button
                leftSection={<IconCircleCheck size={16} />}
                disabled={!can.close}
                onClick={() => setModal('close')}
              >
                Close Defect
              </Button>
            )}
            {can.reopen && (
              <Button variant="default" onClick={() => setModal('reopen')}>
                Reopen
              </Button>
            )}
          </>
        }
      />
      <Stack>
        {failure && <Alert color="red">{failure}</Alert>}
        {defect.status !== 'closed' && defect.closeBlockers.length > 0 && (
          <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Before it can close">
            {defect.closeBlockers.map((blocker) => (
              <Text size="sm" key={blocker}>
                {blocker}
              </Text>
            ))}
          </Alert>
        )}
        {defect.status === 'closed' && defect.plant.status === 'restricted' && (
          <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="The plant is still Restricted/Offline">
            Closing a Defect does not return plant to service. A Supervisor, Manager or Admin does that on the{' '}
            <Anchor component={Link} href={`/plant/${defect.plant.id}`}>
              plant
            </Anchor>
            .
          </Alert>
        )}
        {defect.reopenReason && (
          <Alert color="orange" title="Reopened">
            {defect.reopenReason} — {defect.reopenedBy}, {formatDateTime(defect.reopenedAt, tz)}
          </Alert>
        )}
        <Card withBorder>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <DetailList
              items={[
                {
                  label: 'Plant',
                  value: (
                    <Anchor component={Link} href={`/plant/${defect.plant.id}?tab=defects`}>
                      {defect.plant.assetId} {defect.plant.name}
                    </Anchor>
                  ),
                },
                { label: 'Site', value: defect.plant.site.name },
                {
                  label: 'Raised from',
                  value:
                    defect.source.kind === 'check' ? (
                      <Anchor component={Link} href={`/checks/${defect.source.id}`}>
                        {defect.source.ref}
                      </Anchor>
                    ) : (
                      <Anchor component={Link} href={`/plant/${defect.plant.id}?tab=reception`}>
                        Reception
                      </Anchor>
                    ),
                },
                { label: 'Question', value: defect.questionText },
                {
                  label: 'Failed answer',
                  value: `${showValue(defect.answer)}${defect.answerComment ? ` — ${defect.answerComment}` : ''}`,
                },
              ]}
            />
            <DetailList
              items={[
                { label: 'Raised by', value: `${defect.raisedBy}, ${formatDateTime(defect.raisedAt, tz)}` },
                { label: 'Assigned to', value: defect.assignee?.name ?? 'Unassigned' },
                { label: 'Keeps plant Offline', value: defect.restrictsPlant ? 'Yes, until closed' : 'No' },
                ...(defect.startedAt ? [{ label: 'Started', value: `${defect.startedBy}, ${formatDateTime(defect.startedAt, tz)}` }] : []),
                ...(defect.closedAt
                  ? [{ label: 'Closed', value: `${defect.closedBy}, ${formatDateTime(defect.closedAt, tz)}${defect.closeNote ? ` — ${defect.closeNote}` : ''}` }]
                  : []),
              ]}
            />
          </SimpleGrid>
          {defect.sourceEvidence.length > 0 && (
            <Group gap="xs" mt="md">
              <Text size="sm" fw={500}>
                Evidence with the failure:
              </Text>
              {defect.sourceEvidence.map((file) => (
                <Anchor
                  key={file.id}
                  component="button"
                  type="button"
                  size="sm"
                  onClick={() =>
                    openFile(
                      defect.source.kind === 'check'
                        ? `/checks/${defect.source.id}/evidence/${file.id}/file`
                        : `/receptions/${defect.source.id}/evidence/${file.id}/file`,
                    )
                  }
                >
                  {file.fileName}
                </Anchor>
              ))}
            </Group>
          )}
        </Card>
        {can.assign && <AssignCard defect={defect} />}
        {(defect.status !== 'open' || defect.correctiveAction) && <WorkCard key={defect.updatedAt} defect={defect} />}
        <VerificationCard defect={defect} />
        <Card withBorder>
          <Title order={4} mb="sm">
            History
          </Title>
          <Stack gap={4}>
            {defect.history.map((event) => (
              <Text size="sm" key={event.id}>
                {formatDateTime(event.occurredAt, tz)} · {event.actorName ?? 'System'} · <b>{auditActionLabel(event.action)}</b>
                <Text span size="xs" c="dimmed">
                  {' '}
                  — {event.summary}
                </Text>
              </Text>
            ))}
          </Stack>
        </Card>
      </Stack>
      {modal === 'close' && (
        <ReasonModal title={`Close ${defect.ref}`} label="Note" required={false} confirm="Close Defect" onConfirm={closeWith} onClose={() => setModal(null)} />
      )}
      {modal === 'reopen' && (
        <ReasonModal title={`Reopen ${defect.ref}`} label="Reason" required confirm="Reopen" onConfirm={reopenWith} onClose={() => setModal(null)} />
      )}
    </>
  );
}
