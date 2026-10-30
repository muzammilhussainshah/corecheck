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
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { IconCamera, IconCheck, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import {
  type AnswerValue,
  answerFails,
  type ApiError,
  evidenceRequired,
  type PlantDetail,
  RECEPTION_STATUS_LABELS,
  type ReceptionCheck,
  type ReceptionStatus,
  type TemplateQuestion,
} from '@corecheck/shared';
import {
  COLORS,
  confirmAction,
  EmptyState,
  ErrorAlert,
  formatDateTime,
  Pill,
  type Tone,
} from '@corecheck/ui';
import {
  useAddReceptionPhotoMutation,
  useAssignReceptionMutation,
  usePlantReceptionQuery,
  useReceptionActionMutation,
  useRemoveReceptionPhotoMutation,
  useSaveReceptionAnswersMutation,
  useTemplatesQuery,
} from '../../lib/api';
import { useConfigList } from '../../lib/config';
import { openFile } from '../../lib/download';
import { useSession } from '../../lib/session';

const STATUS_TONES: Record<ReceptionStatus, Tone> = {
  open: 'info',
  returned: 'warning',
  submitted: 'warning',
  approved: 'success',
  restricted: 'danger',
  cancelled: 'neutral',
};

const ReceptionBadge = ({ status }: { status: ReceptionStatus }) => (
  <Pill tone={STATUS_TONES[status]}>{RECEPTION_STATUS_LABELS[status]}</Pill>
);

interface Draft {
  value: AnswerValue;
  comment: string;
}

const showValue = (question: TemplateQuestion, value: AnswerValue) => {
  if (value === null) return '—';
  if (value === 'pass') return 'Pass';
  if (value === 'fail') return 'Fail';
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  return String(value);
};

/** The input for one question while the check is being filled in. */
function AnswerInput({
  question,
  value,
  unit,
  onChange,
}: {
  question: TemplateQuestion;
  value: AnswerValue;
  unit?: string;
  onChange: (value: AnswerValue) => void;
}) {
  switch (question.type) {
    case 'pass_fail':
    case 'yes_no': {
      const options =
        question.type === 'pass_fail'
          ? [
              { value: 'pass', label: 'Pass' },
              { value: 'fail', label: 'Fail' },
            ]
          : [
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ];
      return (
        <SegmentedControl
          aria-label={question.text}
          data={options}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          style={{ alignSelf: 'flex-start' }}
        />
      );
    }
    case 'number':
    case 'meter':
      return (
        <NumberInput
          aria-label={question.text}
          maw={240}
          suffix={unit ? ` ${unit}` : undefined}
          min={question.type === 'meter' ? 0 : undefined}
          value={typeof value === 'number' ? value : ''}
          onChange={(next) => onChange(typeof next === 'number' ? next : null)}
        />
      );
    case 'text':
      return (
        <Textarea
          aria-label={question.text}
          autosize
          minRows={2}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
    default:
      return null;
  }
}

function ReturnModal({
  check,
  opened,
  onClose,
}: {
  check: ReceptionCheck;
  opened: boolean;
  onClose: () => void;
}) {
  const [act, { isLoading }] = useReceptionActionMutation();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!comment.trim()) return setError('Say what needs correcting.');
    const result = await act({ checkId: check.id, action: 'return', comment });
    if (!result.error) {
      setComment('');
      onClose();
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Return for correction">
      <Stack>
        <Text size="sm" c="dimmed">
          The plant goes back to Pending Reception so it can be corrected. This
          submission stays on record.
        </Text>
        <Textarea
          label="Comment"
          required
          autosize
          minRows={2}
          value={comment}
          onChange={(event) => {
            setComment(event.currentTarget.value);
            setError(null);
          }}
          error={error}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button color="orange" loading={isLoading} onClick={submit}>
            Return
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** One reception check: the answers, evidence and what can be done next. */
function CheckView({ check }: { check: ReceptionCheck }) {
  const { me } = useSession();
  const tz = me?.organisation.timeZone;
  const { data: meters } = useConfigList('meter-types', {
    includeArchived: true,
  });
  const [saveAnswers, saving] = useSaveReceptionAnswersMutation();
  const [act, acting] = useReceptionActionMutation();
  const [addPhoto, adding] = useAddReceptionPhotoMutation();
  const [removePhoto] = useRemoveReceptionPhotoMutation();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      check.answers.map((answer) => [
        answer.questionId,
        { value: answer.value, comment: answer.comment ?? '' },
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [returning, setReturning] = useState(false);
  const can = check.capabilities;

  const draftOf = (id: string): Draft =>
    drafts[id] ?? { value: null, comment: '' };
  const change = (id: string, patch: Partial<Draft>) => {
    setDrafts((all) => ({ ...all, [id]: { ...draftOf(id), ...patch } }));
    setErrors((all) => {
      const rest = { ...all };
      delete rest[`answers.${id}`];
      return rest;
    });
  };

  const persist = async () =>
    saveAnswers({
      checkId: check.id,
      answers: check.questions
        .filter((question) => question.type !== 'photo' || drafts[question.id])
        .map((question) => ({
          questionId: question.id,
          value: draftOf(question.id).value,
          comment: draftOf(question.id).comment,
        })),
    });

  const submit = async () => {
    const saved = await persist();
    if (saved.error) return;
    const result = await act({ checkId: check.id, action: 'submit' });
    if (result.error) {
      const grouped: Record<string, string[]> = {};
      for (const item of (result.error as ApiError).fieldErrors ?? [])
        (grouped[item.field] ??= []).push(item.message);
      setErrors(grouped);
    }
  };

  const photosOf = (id: string) =>
    check.evidence.filter((item) => item.questionId === id);
  const answerOf = (id: string) =>
    check.answers.find((answer) => answer.questionId === id);

  return (
    <Stack>
      <Card withBorder>
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Group gap="sm">
              <Title order={4}>{check.template.name}</Title>
              <ReceptionBadge status={check.status} />
            </Group>
            <Text size="sm" c={COLORS.muted}>
              Version {check.template.version} · assigned by {check.assignedBy}{' '}
              on {formatDateTime(check.assignedAt, tz)}
            </Text>
            {check.submittedAt && (
              <Text size="sm" c={COLORS.muted}>
                Submitted by {check.submittedBy} on{' '}
                {formatDateTime(check.submittedAt, tz)}
              </Text>
            )}
            {check.reviewedBy && (
              <Text size="sm" c={COLORS.muted}>
                Reviewed by {check.reviewedBy} on{' '}
                {formatDateTime(check.reviewedAt, tz)}
              </Text>
            )}
          </Stack>
          <Group gap="xs">
            {can.cancel && (
              <Button
                variant="default"
                onClick={() =>
                  confirmAction({
                    title: 'Cancel this reception check?',
                    message:
                      'Answers so far are kept on the cancelled check. A new template can then be assigned.',
                    confirmLabel: 'Cancel check',
                    danger: true,
                    onConfirm: async () => {
                      await act({ checkId: check.id, action: 'cancel' });
                    },
                  })
                }
              >
                Cancel check
              </Button>
            )}
            {can.returnForCorrection && (
              <Button variant="default" onClick={() => setReturning(true)}>
                Return for correction
              </Button>
            )}
            {can.approve && (
              <Button
                leftSection={<IconCheck size={16} />}
                loading={acting.isLoading}
                onClick={() => act({ checkId: check.id, action: 'approve' })}
              >
                Approve
              </Button>
            )}
          </Group>
        </Group>
        {check.status === 'returned' && check.reviewComment && (
          <Alert mt="md" color="orange" title="Returned for correction">
            {check.reviewComment}
          </Alert>
        )}
        {check.outcomeReasons.length > 0 && (
          <Alert
            mt="md"
            color={check.status === 'restricted' ? 'red' : 'yellow'}
            title={
              check.status === 'restricted'
                ? 'Reception failed'
                : 'Needs attention before approval'
            }
          >
            <Stack gap={2}>
              {check.outcomeReasons.map((reason) => (
                <Text size="sm" key={reason}>
                  {reason}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}
      </Card>

      {check.questions.map((question, index) => {
        const draft = draftOf(question.id);
        const fails = answerFails(question, draft.value);
        const photos = photosOf(question.id);
        const answer = answerOf(question.id);
        const commentNeeded = evidenceRequired(question.requireComment, fails);
        const photoNeeded =
          question.type === 'photo'
            ? question.mandatory
            : evidenceRequired(question.requirePhoto, fails);
        const unit = meters?.find((m) => m.id === question.meterTypeId)?.unit;
        const problems = errors[`answers.${question.id}`] ?? [];
        return (
          <Card
            withBorder
            key={question.id}
            style={
              problems.length
                ? { borderColor: 'var(--mantine-color-red-6)' }
                : undefined
            }
          >
            <Stack gap="xs">
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Text fw={600} size="sm">
                  {index + 1}. {question.text}
                  {question.mandatory && (
                    <Text span c="red">
                      {' '}
                      *
                    </Text>
                  )}
                </Text>
                {fails && <Pill tone="danger">Fail</Pill>}
              </Group>
              {can.answer ? (
                <>
                  <AnswerInput
                    question={question}
                    value={draft.value}
                    unit={unit}
                    onChange={(value) => change(question.id, { value })}
                  />
                  {(question.requireComment !== 'never' ||
                    draft.comment ||
                    fails) && (
                    <Textarea
                      label="Comment"
                      required={commentNeeded}
                      autosize
                      minRows={1}
                      value={draft.comment}
                      onChange={(event) =>
                        change(question.id, {
                          comment: event.currentTarget.value,
                        })
                      }
                    />
                  )}
                </>
              ) : (
                question.type !== 'photo' && (
                  <Text size="sm">
                    {showValue(question, answer?.value ?? null)}
                    {unit && answer?.value != null ? ` ${unit}` : ''}
                    {answer?.comment ? ` — ${answer.comment}` : ''}
                  </Text>
                )
              )}
              {photos.length > 0 && (
                <Group gap="xs">
                  {photos.map((photo) => (
                    <Group gap={4} key={photo.id}>
                      <Anchor
                        component="button"
                        type="button"
                        size="sm"
                        onClick={() =>
                          openFile(
                            `/receptions/${check.id}/evidence/${photo.id}/file`,
                          )
                        }
                      >
                        {photo.fileName}
                      </Anchor>
                      {can.answer && (
                        <Anchor
                          component="button"
                          type="button"
                          c="red"
                          aria-label={`Remove ${photo.fileName}`}
                          onClick={() =>
                            removePhoto({
                              checkId: check.id,
                              evidenceId: photo.id,
                            })
                          }
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
                  accept="image/jpeg,image/png"
                  onChange={(file) => {
                    if (!file) return;
                    const form = new FormData();
                    form.append('file', file);
                    void addPhoto({
                      checkId: check.id,
                      questionId: question.id,
                      form,
                    });
                    change(question.id, {});
                  }}
                >
                  {(props) => (
                    <Button
                      {...props}
                      variant="default"
                      size="xs"
                      leftSection={<IconCamera size={14} />}
                      loading={adding.isLoading}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      Add photo{photoNeeded ? ' (required)' : ''}
                    </Button>
                  )}
                </FileButton>
              )}
              {answer && (
                <Text size="xs" c={COLORS.muted}>
                  Answered by {answer.answeredBy} on{' '}
                  {formatDateTime(answer.answeredAt, tz)}
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

      {can.answer && (
        <Group justify="flex-end">
          <Button
            variant="default"
            loading={saving.isLoading}
            onClick={persist}
          >
            Save draft
          </Button>
          {can.submit && (
            <Button loading={acting.isLoading} onClick={submit}>
              Submit reception
            </Button>
          )}
        </Group>
      )}

      {check.submissions.length > 0 && (
        <Card withBorder>
          <Title order={4} mb="sm">
            Submissions
          </Title>
          <Stack gap={6}>
            {check.submissions.map((submission) => (
              <Text size="sm" key={submission.id}>
                {formatDateTime(submission.submittedAt, tz)} by{' '}
                {submission.submittedBy}:{' '}
                {submission.outcome === 'approved'
                  ? 'Approved'
                  : submission.outcome === 'restricted'
                    ? 'Restricted'
                    : 'Sent for approval'}
                {submission.outcomeReasons.length
                  ? ` (${submission.outcomeReasons.join('; ')})`
                  : ''}
              </Text>
            ))}
          </Stack>
        </Card>
      )}
      <ReturnModal
        check={check}
        opened={returning}
        onClose={() => setReturning(false)}
      />
    </Stack>
  );
}

/** Assigns a published reception template (REC-002). */
function AssignCard({ plantId }: { plantId: string }) {
  const { data: templates } = useTemplatesQuery({ purpose: 'reception' });
  const [assign, { isLoading }] = useAssignReceptionMutation();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const published = (templates ?? []).filter((item) => item.publishedVersion);
  return (
    <Card withBorder>
      <Title order={4} mb="xs">
        Start reception
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Choose the reception template for this plant. Anyone assigned to its
        site can then complete it.
      </Text>
      <Group align="flex-end">
        <Select
          label="Reception template"
          placeholder="Select template"
          style={{ flex: 1 }}
          maw={420}
          data={published.map((item) => ({
            value: item.id,
            label: `${item.name} (v${item.publishedVersion})`,
          }))}
          nothingFoundMessage="Publish a template under Manage › Reception templates"
          value={templateId}
          onChange={setTemplateId}
        />
        <Button
          disabled={!templateId}
          loading={isLoading}
          onClick={() =>
            templateId && assign({ plantId, templateId: templateId })
          }
        >
          Assign
        </Button>
      </Group>
    </Card>
  );
}

/** A plant's reception (FRD 8). */
export function ReceptionTab({ plant }: { plant: PlantDetail }) {
  const { data, error, isLoading } = usePlantReceptionQuery(plant.id);
  if (error) return <ErrorAlert error={error as ApiError} />;
  if (isLoading || !data)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  const { current, capabilities } = data;
  return (
    <Stack>
      {capabilities.assign && <AssignCard plantId={plant.id} />}
      {current ? (
        // Remounted when the saved state moves on, so the form starts from it.
        <CheckView
          key={`${current.id}-${current.status}-${current.submissions.length}`}
          check={current}
        />
      ) : (
        !capabilities.assign && (
          <Card withBorder>
            <EmptyState
              title="No reception check yet"
              message="A Supervisor, Manager or Admin assigns a reception template to start."
            />
          </Card>
        )
      )}
    </Stack>
  );
}
