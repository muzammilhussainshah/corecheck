'use client';

import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  Checkbox,
  FileButton,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import {
  IconAlertTriangle,
  IconCheck,
  IconFileDownload,
  IconPaperclip,
  IconX,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  type AnswerValue,
  answerFails,
  type ApiError,
  auditActionLabel,
  type CheckDetail,
  CHECK_SOURCE_LABELS,
  DEFECT_SEVERITY_LABELS,
  describeCondition,
  ERROR_CODES,
  evidenceRequired,
  questionVisible,
  TEMPLATE_PURPOSE_LABELS,
} from '@corecheck/shared';
import {
  COLORS,
  DetailList,
  ErrorAlert,
  formatDate,
  formatDateTime,
  Pill,
} from '@corecheck/ui';
import { AppPageHeader } from '../../../../components/AppPageHeader';
import { AnswerInput, showValue } from '../../../../components/checks/AnswerInput';
import {
  type AssigneeValues,
  AssigneeFields,
} from '../../../../components/checks/AssigneeFields';
import {
  assigneeText,
  CheckStatusBadge,
  DefectStatusBadge,
  SeverityBadge,
} from '../../../../components/checks/badges';
import {
  api,
  useAddCheckEvidenceMutation,
  useAssignCheckMutation,
  useCheckQuery,
  useCheckReasonActionMutation,
  useRemoveCheckEvidenceMutation,
  useRescheduleCheckMutation,
  useReviewCheckMutation,
  useSaveCheckAnswersMutation,
  useSubmitCheckMutation,
} from '../../../../lib/api';
import { useConfigList } from '../../../../lib/config';
import { downloadFile, openFile } from '../../../../lib/download';
import { useSession } from '../../../../lib/session';

interface Draft {
  value: AnswerValue;
  comment: string;
}

/** A reason-only action: reopen or cancel (CHK-010, CHK-011). */
function ReasonModal({
  check,
  action,
  onClose,
}: {
  check: CheckDetail;
  action: 'reopen' | 'cancel';
  onClose: () => void;
}) {
  const [act, { isLoading }] = useCheckReasonActionMutation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!reason.trim()) return setError('Give the reason.');
    const result = await act({ id: check.id, action, reason });
    if (result.error) return setError((result.error as ApiError).message);
    onClose();
  };
  return (
    <Modal
      opened
      onClose={onClose}
      title={action === 'reopen' ? `Reopen ${check.ref}` : `Cancel ${check.ref}`}
    >
      <Stack>
        <Text size="sm" c="dimmed">
          {action === 'reopen'
            ? 'The check goes back to its contributors for correction. What was submitted stays on record.'
            : 'The check is cancelled/voided. Its answers stay on record.'}
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
            Back
          </Button>
          <Button color={action === 'cancel' ? 'red' : 'orange'} loading={isLoading} onClick={submit}>
            {action === 'reopen' ? 'Reopen' : 'Cancel check'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function AssignModal({ check, onClose }: { check: CheckDetail; onClose: () => void }) {
  const [assign, { isLoading }] = useAssignCheckMutation();
  const [value, setValue] = useState<AssigneeValues>({
    assigneeUserId: check.assignee.user?.id ?? null,
    assigneeTeamId: check.assignee.team?.id ?? null,
    assigneeDisciplineId: check.assignee.discipline?.id ?? null,
  });
  const [error, setError] = useState<string | undefined>();
  const submit = async () => {
    const result = await assign({ id: check.id, ...value });
    if (result.error) return setError((result.error as ApiError).fieldErrors?.[0]?.message);
    onClose();
  };
  return (
    <Modal opened onClose={onClose} title={`Reassign ${check.ref}`} size="lg">
      <Stack>
        <AssigneeFields value={value} onChange={setValue} error={error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={submit}>
            Reassign
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function RescheduleModal({ check, onClose }: { check: CheckDetail; onClose: () => void }) {
  const [reschedule, { isLoading }] = useRescheduleCheckMutation();
  const [dueOn, setDueOn] = useState(check.dueOn ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const submit = async () => {
    const result = await reschedule({ id: check.id, dueOn, reason: reason || undefined });
    if (result.error) {
      const failure = result.error as ApiError;
      return setError(failure.fieldErrors?.[0]?.message ?? failure.message);
    }
    onClose();
  };
  return (
    <Modal opened onClose={onClose} title={`Reschedule ${check.ref}`}>
      <Stack>
        <Text size="sm" c="dimmed">
          Moves this check only. {check.schedule ? 'The schedule’s rule does not change.' : ''}
        </Text>
        <DateInput
          label="New due date"
          required
          valueFormat="D MMM YYYY"
          minDate={new Date()}
          value={dueOn || null}
          onChange={(value) => setDueOn(value ?? '')}
          error={error}
        />
        <Textarea label="Reason" autosize minRows={2} value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} disabled={!dueOn} onClick={submit}>
            Reschedule
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Approve, return or reject submitted work (CHK-009, DFW-005..009). */
function ReviewCard({ check }: { check: CheckDetail }) {
  const [review, { isLoading }] = useReviewCheckMutation();
  const [comment, setComment] = useState('');
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const can = check.capabilities;
  const act = async (decision: 'approve' | 'reject' | 'return') => {
    setError(null);
    const result = await review({
      id: check.id,
      decision,
      comment: comment || undefined,
      override: decision === 'approve' && override,
    });
    if (result.error) {
      const failure = result.error as ApiError;
      setError(failure.fieldErrors?.[0]?.message ?? failure.message);
    }
  };
  return (
    <Card withBorder>
      <Title order={4} mb="xs">
        Review
      </Title>
      {check.reviewBlock && (
        <Alert color="orange" mb="sm" icon={<IconAlertTriangle size={18} />}>
          {check.reviewBlock}
          {can.override
            ? ' You may override this with a reason; the override is kept in the audit.'
            : ''}
        </Alert>
      )}
      <Stack>
        <Textarea
          label={override ? 'Reason for the override' : 'Comment'}
          description="Required to return or reject."
          autosize
          minRows={2}
          value={comment}
          onChange={(event) => {
            setComment(event.currentTarget.value);
            setError(null);
          }}
          error={error}
        />
        {can.override && (
          <Checkbox
            label="Override separation of duties"
            checked={override}
            onChange={(event) => setOverride(event.currentTarget.checked)}
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" color="red" loading={isLoading} onClick={() => act('reject')}>
            Reject
          </Button>
          <Button variant="default" loading={isLoading} onClick={() => act('return')}>
            Return for correction
          </Button>
          {(can.review || (can.override && override)) && (
            <Button leftSection={<IconCheck size={16} />} color={override ? 'orange' : undefined} loading={isLoading} onClick={() => act('approve')}>
              {override ? 'Override and approve' : 'Approve'}
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  );
}

function CheckEditor({ check }: { check: CheckDetail }) {
  const { me } = useSession();
  const tz = me?.organisation.timeZone;
  const { data: meters } = useConfigList('meter-types', { includeArchived: true });
  const [saveAnswers, saving] = useSaveCheckAnswersMutation();
  const [submit, submitting] = useSubmitCheckMutation();
  const [addEvidence, adding] = useAddCheckEvidenceMutation();
  const [removeEvidence] = useRemoveCheckEvidenceMutation();
  // Only answers this person has changed; everything else shows the latest
  // saved state, so several people can work on one check (CHK-003).
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [banner, setBanner] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const can = check.capabilities;
  const answering = can.answer || editing;

  const saved = (id: string) => check.answers.find((answer) => answer.questionId === id);
  const current = (id: string): Draft =>
    drafts[id] ?? { value: saved(id)?.value ?? null, comment: saved(id)?.comment ?? '' };
  const change = (id: string, patch: Partial<Draft>) => {
    setDrafts((all) => ({ ...all, [id]: { ...current(id), ...patch } }));
    setErrors((all) => {
      const rest = { ...all };
      delete rest[`answers.${id}`];
      return rest;
    });
  };
  const showErrors = (error: unknown) => {
    const failure = error as ApiError;
    const grouped: Record<string, string[]> = {};
    for (const item of failure.fieldErrors ?? []) (grouped[item.field] ??= []).push(item.message);
    setErrors(grouped);
    setBanner(failure.fieldErrors?.length ? null : failure);
  };

  const persist = async (): Promise<boolean> => {
    const dirty = Object.entries(drafts);
    if (dirty.length === 0) return true;
    if (editing && !reason.trim()) {
      setErrors({ reason: ['Give the reason for changing a submitted check.'] });
      return false;
    }
    const result = await saveAnswers({
      id: check.id,
      answers: dirty.map(([questionId, draft]) => ({
        questionId,
        value: draft.value,
        comment: draft.comment,
      })),
      reason: editing ? reason : undefined,
    });
    if (result.error) {
      showErrors(result.error);
      return false;
    }
    setDrafts({});
    setBanner(null);
    if (editing) {
      setEditing(false);
      setReason('');
    }
    return true;
  };
  const send = async () => {
    if (!(await persist())) return;
    const result = await submit(check.id);
    if (result.error) showErrors(result.error);
  };

  const valueOf = (id: string) => current(id).value;
  return (
    <Stack>
      {banner && (
        <Alert
          color="red"
          icon={<IconAlertTriangle size={18} />}
          title={banner.code === ERROR_CODES.ALREADY_SUBMITTED ? 'Already submitted' : 'Not saved'}
        >
          {banner.message}
        </Alert>
      )}
      {check.questions.map((question, index) => {
        const asked = questionVisible(question, check.questions, valueOf);
        if (!asked) return null;
        const draft = current(question.id);
        const fails = answerFails(question, draft.value);
        const files = check.evidence.filter((item) => item.questionId === question.id);
        const answer = saved(question.id);
        const unit = meters?.find((m) => m.id === question.meterTypeId)?.unit;
        const problems = errors[`answers.${question.id}`] ?? [];
        const commentNeeded = evidenceRequired(question.requireComment, fails);
        const photoNeeded =
          question.type === 'photo' ? question.mandatory : evidenceRequired(question.requirePhoto, fails);
        const raised = check.defectsRaised.find((defect) => defect.questionId === question.id);
        return (
          <Card
            withBorder
            key={question.id}
            ml={question.showIf ? 'lg' : 0}
            style={problems.length ? { borderColor: 'var(--mantine-color-red-6)' } : undefined}
          >
            <Stack gap="xs">
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Text fw={600} size="sm">
                  {index + 1}. {question.text}
                  {question.mandatory && (
                    <Text span c="red">
                      {' '}*
                    </Text>
                  )}
                </Text>
                <Group gap={6} wrap="nowrap">
                  {fails && <Pill tone="danger">Fail</Pill>}
                  {fails && question.defectSeverity && !raised && (
                    <Pill tone="warning">Raises a {DEFECT_SEVERITY_LABELS[question.defectSeverity]} Defect</Pill>
                  )}
                  {fails && question.offlineOnFail && <Pill tone="danger">Takes plant Offline</Pill>}
                  {raised && (
                    <Anchor component={Link} href={`/defects/${raised.id}`} size="sm">
                      {raised.ref}
                    </Anchor>
                  )}
                </Group>
              </Group>
              {question.showIf && (
                <Text size="xs" c={COLORS.muted}>
                  Follow-up: {describeCondition(question.showIf, check.questions)}
                </Text>
              )}
              {answering ? (
                <>
                  <AnswerInput question={question} value={draft.value} unit={unit} onChange={(value) => change(question.id, { value })} />
                  {(question.requireComment !== 'never' || draft.comment || fails) && (
                    <Textarea
                      label="Comment"
                      required={commentNeeded}
                      autosize
                      minRows={1}
                      value={draft.comment}
                      onChange={(event) => change(question.id, { comment: event.currentTarget.value })}
                    />
                  )}
                </>
              ) : (
                question.type !== 'photo' && (
                  <Text size="sm">
                    {showValue(answer?.value)}
                    {unit && answer?.value != null ? ` ${unit}` : ''}
                    {answer?.comment ? ` — ${answer.comment}` : ''}
                  </Text>
                )
              )}
              {files.length > 0 && (
                <Group gap="xs">
                  {files.map((file) => (
                    <Group gap={4} key={file.id}>
                      <Anchor
                        component="button"
                        type="button"
                        size="sm"
                        onClick={() => openFile(`/checks/${check.id}/evidence/${file.id}/file`)}
                      >
                        {file.fileName}
                      </Anchor>
                      <Text size="xs" c={COLORS.muted}>
                        ({file.uploadedBy})
                      </Text>
                      {can.answer && (
                        <Anchor
                          component="button"
                          type="button"
                          c="red"
                          aria-label={`Remove ${file.fileName}`}
                          onClick={() => removeEvidence({ id: check.id, evidenceId: file.id })}
                        >
                          <IconX size={14} />
                        </Anchor>
                      )}
                    </Group>
                  ))}
                </Group>
              )}
              {can.answer && (
                <FileButton
                  accept="image/jpeg,image/png,application/pdf"
                  onChange={(file) => {
                    if (!file) return;
                    const form = new FormData();
                    form.append('file', file);
                    void addEvidence({ id: check.id, questionId: question.id, form }).then((result) => {
                      if (result.error) showErrors(result.error);
                    });
                  }}
                >
                  {(props) => (
                    <Button
                      {...props}
                      variant="default"
                      size="xs"
                      leftSection={<IconPaperclip size={14} />}
                      loading={adding.isLoading}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      Add photo or file{photoNeeded ? ' (required)' : ''}
                    </Button>
                  )}
                </FileButton>
              )}
              {answer && (
                <Text size="xs" c={COLORS.muted}>
                  Answered by {answer.answeredBy} on {formatDateTime(answer.answeredAt, tz)}
                </Text>
              )}
              {problems.map((problem) => (
                <Text size="xs" c="red" key={problem}>
                  {problem}
                </Text>
              ))}
            </Stack>
          </Card>
        );
      })}

      {editing && (
        <Textarea
          label="Reason for changing the submitted answers"
          required
          autosize
          minRows={2}
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          error={errors.reason?.[0]}
        />
      )}
      <Group justify="flex-end">
        {can.editSubmitted && !editing && (
          <Button variant="default" onClick={() => setEditing(true)}>
            Edit submitted answers
          </Button>
        )}
        {editing && (
          <>
            <Button variant="default" onClick={() => { setEditing(false); setDrafts({}); }}>
              Discard
            </Button>
            <Button loading={saving.isLoading} onClick={persist}>
              Save changes
            </Button>
          </>
        )}
        {can.answer && (
          <>
            <Button variant="default" loading={saving.isLoading} disabled={Object.keys(drafts).length === 0} onClick={persist}>
              Save draft
            </Button>
            <Button loading={submitting.isLoading} onClick={send}>
              Submit
            </Button>
          </>
        )}
      </Group>
    </Stack>
  );
}

export default function CheckPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const tz = me?.organisation.timeZone;
  // While it can still be answered, others' answers appear without a reload
  // (CHK-003); a finished check is not polled.
  const cached = api.endpoints.check.useQueryState(id);
  const live =
    !cached.data || ['due', 'in_progress', 'returned'].includes(cached.data.status);
  const { data: check, error } = useCheckQuery(id, { pollingInterval: live ? 10_000 : 0 });
  const [modal, setModal] = useState<null | 'reopen' | 'cancel' | 'assign' | 'reschedule'>(null);
  const [exporting, setExporting] = useState(false);
  if (error) return <ErrorAlert error={error as ApiError} />;
  if (!check)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  const can = check.capabilities;
  return (
    <>
      <AppPageHeader
        crumbs={[{ label: 'Checks', href: '/checks' }, { label: check.ref }]}
        title={
          <Group gap="sm">
            {check.ref} {check.template.name}
            <CheckStatusBadge status={check.displayStatus} />
          </Group>
        }
        description={`${check.plant.assetId} ${check.plant.name} · ${check.plant.site.name}`}
        actions={
          <>
            {can.export && (
              <Button
                variant="default"
                leftSection={<IconFileDownload size={16} />}
                loading={exporting}
                onClick={async () => {
                  setExporting(true);
                  await downloadFile(`/checks/${check.id}/export`, `${check.ref}.pdf`);
                  setExporting(false);
                }}
              >
                Export PDF
              </Button>
            )}
            {can.assign && (
              <Button variant="default" onClick={() => setModal('assign')}>
                Reassign
              </Button>
            )}
            {can.reschedule && (
              <Button variant="default" onClick={() => setModal('reschedule')}>
                Reschedule
              </Button>
            )}
            {can.reopen && (
              <Button variant="default" onClick={() => setModal('reopen')}>
                Reopen
              </Button>
            )}
            {can.cancel && (
              <Button variant="default" color="red" onClick={() => setModal('cancel')}>
                Cancel
              </Button>
            )}
          </>
        }
      />
      <Stack>
        {check.status === 'scheduled' && (
          <Alert color="blue">This check opens on {formatDate(check.availableOn, tz)}.</Alert>
        )}
        {check.overdue && (
          <Alert color="red" icon={<IconAlertTriangle size={18} />}>
            Overdue: it was due {formatDate(check.dueOn, tz)}.
          </Alert>
        )}
        {check.status === 'returned' && check.reviewComment && (
          <Alert color="orange" title="Returned for correction">
            {check.reviewComment} — {check.reviewedBy}
          </Alert>
        )}
        {check.status === 'rejected' && (
          <Alert color="red" title="Rejected">
            {check.reviewComment} — {check.reviewedBy}
          </Alert>
        )}
        {check.status === 'cancelled' && (
          <Alert color="gray" title="Cancelled/Voided">
            {check.cancelReason}
            {check.cancelledBy ? ` — ${check.cancelledBy}` : ''}
          </Alert>
        )}
        {check.reviewOverrideReason && (
          <Alert color="orange" title="Approved with a separation-of-duties override">
            {check.reviewOverrideReason} — {check.reviewedBy}
          </Alert>
        )}
        <Card withBorder>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <DetailList
              items={[
                {
                  label: 'Plant',
                  value: (
                    <Anchor component={Link} href={`/plant/${check.plant.id}?tab=checks`}>
                      {check.plant.assetId} {check.plant.name}
                    </Anchor>
                  ),
                },
                {
                  label: 'Template',
                  value: `${check.template.name} v${check.template.version} (${TEMPLATE_PURPOSE_LABELS[check.template.purpose]})`,
                },
                { label: 'Source', value: CHECK_SOURCE_LABELS[check.source] },
                ...(check.schedule ? [{ label: 'Schedule', value: check.schedule.name }] : []),
                ...(check.defect
                  ? [
                      {
                        label: 'Verifies',
                        value: (
                          <Anchor component={Link} href={`/defects/${check.defect.id}`}>
                            {check.defect.ref}
                          </Anchor>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            <DetailList
              items={[
                { label: 'Assigned to', value: assigneeText(check.assignee) },
                { label: 'Due', value: check.dueOn ? formatDate(check.dueOn, tz) : 'No due date' },
                { label: 'Approval', value: check.requiresReview ? 'Needs review after submission' : 'Completes on submission' },
                ...(check.submittedAt
                  ? [{ label: 'Submitted', value: `${formatDateTime(check.submittedAt, tz)} by ${check.submittedBy}` }]
                  : []),
                ...(check.reviewedAt
                  ? [{ label: 'Reviewed', value: `${formatDateTime(check.reviewedAt, tz)} by ${check.reviewedBy}` }]
                  : []),
              ]}
            />
          </SimpleGrid>
        </Card>

        {(can.review || can.override) && <ReviewCard check={check} />}

        {/* Remounted only when answering opens or closes, or a submission is
            made: never on Due → In Progress, so unsaved answers survive an
            upload or another person's save. */}
        <CheckEditor
          key={`${check.capabilities.answer}-${check.capabilities.editSubmitted}-${check.submissions.length}-${check.status === 'returned'}`}
          check={check}
        />

        {check.defectsRaised.length > 0 && (
          <Card withBorder>
            <Title order={4} mb="sm">
              Defects raised
            </Title>
            <Stack gap={6}>
              {check.defectsRaised.map((defect) => (
                <Group gap="sm" key={defect.id}>
                  <Anchor component={Link} href={`/defects/${defect.id}`} fw={600}>
                    {defect.ref}
                  </Anchor>
                  <SeverityBadge severity={defect.severity} />
                  <DefectStatusBadge status={defect.status} />
                  <Text size="sm">{check.questions.find((q) => q.id === defect.questionId)?.text}</Text>
                </Group>
              ))}
            </Stack>
          </Card>
        )}

        <Card withBorder>
          <Title order={4} mb="sm">
            Contributors
          </Title>
          {check.contributors.length === 0 ? (
            <Text size="sm" c="dimmed">
              No answers yet.
            </Text>
          ) : (
            <Stack gap={4}>
              {check.contributors.map((person) => (
                <Text size="sm" key={person.name}>
                  <b>{person.name}</b>:{' '}
                  {person.questionIds
                    .map((qid) => `Q${check.questions.findIndex((q) => q.id === qid) + 1}`)
                    .join(', ')}
                </Text>
              ))}
            </Stack>
          )}
        </Card>

        {check.changes.length > 0 && (
          <Card withBorder>
            <Title order={4} mb="sm">
              Answer history
            </Title>
            <Table.ScrollContainer minWidth={640}>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>When</Table.Th>
                    <Table.Th>Who</Table.Th>
                    <Table.Th>Question</Table.Th>
                    <Table.Th>Change</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {check.changes.map((change, index) => (
                    <Table.Tr key={index}>
                      <Table.Td>{formatDateTime(change.changedAt, tz)}</Table.Td>
                      <Table.Td>{change.changedBy}</Table.Td>
                      <Table.Td>{check.questions.find((q) => q.id === change.questionId)?.text ?? change.questionId}</Table.Td>
                      <Table.Td>
                        {showValue(change.previousValue)} → {showValue(change.value)}
                        {change.comment && change.comment !== change.previousComment ? ` (comment: ${change.comment})` : ''}
                        {change.afterSubmission && (
                          <Text size="xs" c="orange.8">
                            After submission: {change.reason}
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        )}

        {check.submissions.length > 0 && (
          <Card withBorder>
            <Title order={4} mb="sm">
              Submissions
            </Title>
            <Stack gap={6}>
              {check.submissions.map((submission) => (
                <Text size="sm" key={submission.id}>
                  {formatDateTime(submission.submittedAt, tz)} by {submission.submittedBy}:{' '}
                  {submission.outcome === 'completed' ? 'Completed' : 'Sent for review'}
                  {submission.outcomeReasons.length ? ` (${submission.outcomeReasons.join('; ')})` : ''}
                </Text>
              ))}
            </Stack>
          </Card>
        )}

        <Card withBorder>
          <Title order={4} mb="sm">
            History
          </Title>
          <Stack gap={4}>
            {check.history.map((event) => (
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
      {(modal === 'reopen' || modal === 'cancel') && <ReasonModal check={check} action={modal} onClose={() => setModal(null)} />}
      {modal === 'assign' && <AssignModal check={check} onClose={() => setModal(null)} />}
      {modal === 'reschedule' && <RescheduleModal check={check} onClose={() => setModal(null)} />}
    </>
  );
}
