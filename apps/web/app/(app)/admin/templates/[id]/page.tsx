'use client';

import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Center,
  Checkbox,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconArchive,
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconPencil,
  IconPlus,
  IconRestore,
  IconRocket,
  IconTrash,
} from '@tabler/icons-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  type ApiError,
  APPROVAL_MODE_LABELS,
  APPROVAL_MODES,
  type ApprovalMode,
  type CheckTemplateDetail,
  DEFECT_SEVERITIES,
  DEFECT_SEVERITY_LABELS,
  EVIDENCE_RULE_LABELS,
  EVIDENCE_RULES,
  type EvidenceRule,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  questionCanFail,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_FREQUENCY_LABELS,
  SCHEDULE_UNIT_LABELS,
  SCHEDULE_UNITS,
  SEPARATION_RULE_LABELS,
  SEPARATION_RULES,
  type SeparationRule,
  type TemplateEligibility,
  TEMPLATE_PURPOSE_LABELS,
  type TemplateQuestion,
  type TemplateRecurrence,
} from '@corecheck/shared';
import { ErrorAlert, Pill } from '@corecheck/ui';
import { AppPageHeader } from '../../../../../components/AppPageHeader';
import {
  useDisciplinesQuery,
  useDuplicateTemplateMutation,
  useSaveTemplateDraftMutation,
  useTeamsQuery,
  useTemplateActionMutation,
  useTemplateQuery,
  useUsersQuery,
} from '../../../../../lib/api';
import { useConfigList } from '../../../../../lib/config';
import { useSession } from '../../../../../lib/session';

const blankQuestion = (): TemplateQuestion => ({
  id: crypto.randomUUID().slice(0, 12),
  text: '',
  type: 'pass_fail',
  mandatory: true,
  failAnswer: null,
  min: null,
  max: null,
  meterTypeId: null,
  requireComment: 'never',
  requirePhoto: 'never',
  options: [],
  failOptions: [],
  offlineOnFail: false,
  defectSeverity: null,
  showIf: null,
});

const EMPTY_ELIGIBILITY: TemplateEligibility = {
  plantTypeIds: [],
  categoryIds: [],
  disciplineIds: [],
  teamIds: [],
  userIds: [],
};

/** Answers an earlier question offers, for a follow-up condition. */
const answersOf = (question: TemplateQuestion | undefined): string[] => {
  if (!question) return [];
  if (question.type === 'single_select') return question.options;
  if (question.type === 'yes_no') return ['yes', 'no'];
  if (question.type === 'pass_fail') return ['pass', 'fail'];
  return [];
};

const toNumber = (value: string | number): number | null =>
  typeof value === 'number' ? value : null;

function QuestionCard({
  question,
  index,
  total,
  earlier,
  meters,
  errors,
  readOnly,
  onChange,
  onMove,
  onRemove,
}: {
  question: TemplateQuestion;
  index: number;
  total: number;
  /** Questions before this one, which it may follow up. */
  earlier: TemplateQuestion[];
  meters: { value: string; label: string }[];
  errors: Record<string, string>;
  readOnly: boolean;
  onChange: (patch: Partial<TemplateQuestion>) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}) {
  const canFail = questionCanFail(question);
  const rule = (key: 'requireComment' | 'requirePhoto', label: string) => (
    <Select
      label={label}
      allowDeselect={false}
      disabled={readOnly}
      data={EVIDENCE_RULES.filter((item) => canFail || item !== 'on_fail').map(
        (item) => ({ value: item, label: EVIDENCE_RULE_LABELS[item] }),
      )}
      value={question[key]}
      onChange={(value) => onChange({ [key]: value as EvidenceRule })}
      error={errors[key]}
    />
  );
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Text fw={600} size="sm">
          Question {index + 1}
        </Text>
        {!readOnly && (
          <Group gap={4}>
            <ActionIcon
              variant="subtle"
              aria-label={`Move question ${index + 1} up`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <IconArrowUp size={16} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              aria-label={`Move question ${index + 1} down`}
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              <IconArrowDown size={16} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={`Remove question ${index + 1}`}
              onClick={onRemove}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        )}
      </Group>
      <Stack gap="sm">
        <TextInput
          label="Question"
          required
          disabled={readOnly}
          value={question.text}
          onChange={(event) => onChange({ text: event.currentTarget.value })}
          error={errors.text}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Answer type"
            allowDeselect={false}
            disabled={readOnly}
            data={QUESTION_TYPES.map((type) => ({
              value: type,
              label: QUESTION_TYPE_LABELS[type],
            }))}
            value={question.type}
            onChange={(value) =>
              onChange({
                type: value as TemplateQuestion['type'],
                // Settings of the old type no longer apply.
                failAnswer: null,
                min: null,
                max: null,
                meterTypeId: null,
                options: [],
                failOptions: [],
                offlineOnFail: false,
                defectSeverity: null,
                requireComment: 'never',
                requirePhoto: 'never',
              })
            }
          />
          {question.type === 'yes_no' && (
            <Select
              label="Which answer is a fail?"
              placeholder="Neither"
              clearable
              disabled={readOnly}
              data={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
              value={question.failAnswer}
              onChange={(value) =>
                onChange({ failAnswer: value as 'yes' | 'no' | null })
              }
            />
          )}
          {question.type === 'single_select' && (
            <MultiSelect
              label="Which choices are a fail?"
              placeholder="None"
              disabled={readOnly}
              data={question.options}
              value={question.failOptions.filter((item) =>
                question.options.includes(item),
              )}
              onChange={(value) => onChange({ failOptions: value })}
              error={errors.failOptions}
            />
          )}
          {question.type === 'meter' && (
            <Select
              label="Meter"
              required
              disabled={readOnly}
              data={meters}
              nothingFoundMessage="Add meter types under Manage › Meter types"
              value={question.meterTypeId}
              onChange={(value) => onChange({ meterTypeId: value })}
              error={errors.meterTypeId}
            />
          )}
          {question.type === 'number' && (
            <Group grow align="flex-start">
              <NumberInput
                label="Lowest allowed"
                disabled={readOnly}
                value={question.min ?? ''}
                onChange={(value) => onChange({ min: toNumber(value) })}
              />
              <NumberInput
                label="Highest allowed"
                disabled={readOnly}
                value={question.max ?? ''}
                onChange={(value) => onChange({ max: toNumber(value) })}
                error={errors.max}
              />
            </Group>
          )}
        </SimpleGrid>
        {question.type === 'single_select' && (
          <TagsInput
            label="Choices"
            description="Type a choice and press Enter. At least two."
            disabled={readOnly}
            value={question.options}
            onChange={(value) =>
              onChange({
                options: value,
                failOptions: question.failOptions.filter((item) =>
                  value.includes(item),
                ),
              })
            }
            error={errors.options}
          />
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {rule('requireComment', 'Comment')}
          {question.type !== 'photo' && rule('requirePhoto', 'Photo')}
        </SimpleGrid>
        <Switch
          label="Mandatory"
          disabled={readOnly}
          checked={question.mandatory}
          onChange={(event) =>
            onChange({ mandatory: event.currentTarget.checked })
          }
        />
        {canFail && (
          <>
            <Switch
              label="A fail takes the plant Offline"
              description="Plant cannot go Online while this answer fails."
              disabled={readOnly}
              checked={question.offlineOnFail}
              onChange={(event) =>
                onChange({ offlineOnFail: event.currentTarget.checked })
              }
            />
            <Select
              label="Defect trigger"
              description="A failed answer raises a Defect of this severity. Without one, a fail raises no Defect."
              placeholder="No Defect"
              clearable
              disabled={readOnly}
              data={DEFECT_SEVERITIES.map((item) => ({
                value: item,
                label: DEFECT_SEVERITY_LABELS[item],
              }))}
              value={question.defectSeverity}
              onChange={(value) =>
                onChange({
                  defectSeverity: value as TemplateQuestion['defectSeverity'],
                })
              }
            />
          </>
        )}
        {earlier.length > 0 && (
          <FollowUp
            question={question}
            earlier={earlier}
            readOnly={readOnly}
            error={errors.showIf}
            onChange={(showIf) => onChange({ showIf })}
          />
        )}
      </Stack>
    </Card>
  );
}

/** Conditional follow-up: ask this only after a given answer (TMP-009). */
function FollowUp({
  question,
  earlier,
  readOnly,
  error,
  onChange,
}: {
  question: TemplateQuestion;
  earlier: TemplateQuestion[];
  readOnly: boolean;
  error?: string;
  onChange: (showIf: TemplateQuestion['showIf']) => void;
}) {
  const condition = question.showIf;
  const parent = earlier.find((item) => item.id === condition?.questionId);
  const choices = answersOf(parent);
  const whenOptions = [
    ...(parent && questionCanFail(parent)
      ? [
          { value: 'fail', label: 'it fails' },
          { value: 'pass', label: 'it passes' },
        ]
      : []),
    ...(choices.length ? [{ value: 'values', label: 'it is answered…' }] : []),
  ];
  return (
    <Stack gap="xs">
      <Switch
        label="Follow-up question"
        description="Asked only when an earlier question is answered a certain way. Not asked, it is never mandatory."
        disabled={readOnly}
        checked={!!condition}
        onChange={(event) =>
          onChange(
            event.currentTarget.checked
              ? {
                  questionId: earlier[earlier.length - 1]!.id,
                  when: questionCanFail(earlier[earlier.length - 1]!)
                    ? 'fail'
                    : 'values',
                  values: [],
                }
              : null,
          )
        }
      />
      {condition && (
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label="Ask when"
            allowDeselect={false}
            disabled={readOnly}
            data={earlier.map((item, at) => ({
              value: item.id,
              label: `${at + 1}. ${item.text || 'Untitled question'}`,
            }))}
            value={condition.questionId}
            onChange={(value) => {
              const next = earlier.find((item) => item.id === value);
              onChange({
                questionId: value!,
                when: next && questionCanFail(next) ? 'fail' : 'values',
                values: [],
              });
            }}
            error={error}
          />
          <Select
            label="…and"
            allowDeselect={false}
            disabled={readOnly}
            data={whenOptions}
            value={condition.when}
            onChange={(value) =>
              onChange({
                ...condition,
                when: value as 'fail' | 'pass' | 'values',
                values: [],
              })
            }
          />
          {condition.when === 'values' && (
            <MultiSelect
              label="Answers"
              disabled={readOnly}
              data={choices}
              value={condition.values}
              onChange={(values) => onChange({ ...condition, values })}
            />
          )}
        </SimpleGrid>
      )}
    </Stack>
  );
}

/** Edits one version's questions; remounted when the version changes. */
function TemplateEditor({ template }: { template: CheckTemplateDetail }) {
  const { can } = useSession();
  const version = template.draft ?? template.published;
  const manage = can('templates.manage') && !template.archivedAt;
  const readOnly = !manage || !template.draft;
  const { data: meterTypes } = useConfigList('meter-types');
  const [save, saving] = useSaveTemplateDraftMutation();
  const [act, acting] = useTemplateActionMutation();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(
    version?.approvalMode ?? 'manual',
  );
  const [questions, setQuestions] = useState<TemplateQuestion[]>(
    version?.questions ?? [],
  );
  const [eligibility, setEligibility] = useState<TemplateEligibility>(
    version?.eligibility ?? EMPTY_ELIGIBILITY,
  );
  const [separation, setSeparation] = useState<SeparationRule>(
    version?.separation ?? 'major_critical',
  );
  const [requireCorrectiveAction, setRequireCorrectiveAction] = useState(
    version?.requireCorrectiveAction ?? false,
  );
  const [requireRepairEvidence, setRequireRepairEvidence] = useState(
    version?.requireRepairEvidence ?? false,
  );
  const [recurrence, setRecurrence] = useState<TemplateRecurrence | null>(
    version?.recurrence ?? null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const purpose = template.purpose;
  const verification = purpose === 'defect_verification';
  const { data: plantTypes } = useConfigList('plant-types');
  const { data: categories } = useConfigList('plant-categories');
  const { data: teams } = useTeamsQuery();
  const { data: disciplines } = useDisciplinesQuery();
  const { data: users } = useUsersQuery({
    page: 1,
    pageSize: 100,
    status: 'active',
  });
  const options = (list: { id: string; name: string }[] | undefined) =>
    (list ?? []).map((item) => ({ value: item.id, label: item.name }));

  const update = (index: number, patch: Partial<TemplateQuestion>) =>
    setQuestions((list) =>
      list.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    );
  const move = (index: number, offset: number) =>
    setQuestions((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + offset, 0, item!);
      return next;
    });

  const saveDraft = async (): Promise<boolean> => {
    setErrors({});
    const result = await save({
      id: template.id,
      name,
      description,
      approvalMode,
      questions,
      eligibility,
      separation,
      requireCorrectiveAction,
      requireRepairEvidence,
      recurrence: purpose === 'reception' || verification ? null : recurrence,
    });
    if (result.error) {
      const failure = result.error as ApiError;
      setErrors(
        Object.fromEntries(
          (failure.fieldErrors ?? []).map((item) => [item.field, item.message]),
        ),
      );
      return false;
    }
    return true;
  };

  const errorsOf = (index: number) => {
    const prefix = `questions.${index}.`;
    return Object.fromEntries(
      Object.entries(errors)
        .filter(([field]) => field.startsWith(prefix))
        .map(([field, message]) => [field.slice(prefix.length), message]),
    );
  };

  return (
    <>
      <AppPageHeader
        crumbs={[
          { label: 'Templates', href: '/admin/templates' },
          { label: template.name },
        ]}
        title={
          <Group gap="sm">
            {template.name}
            <Pill tone="neutral">{TEMPLATE_PURPOSE_LABELS[purpose]}</Pill>
            {template.draft ? (
              <Pill tone="info">Draft v{template.draft.version}</Pill>
            ) : null}
            {template.published && (
              <Pill tone="success">
                Published v{template.published.version}
              </Pill>
            )}
          </Group>
        }
        description="Published versions never change. Checks keep the version they started from."
        actions={
          can('templates.manage') && (
            <>
              {manage && !template.draft && (
                <Button
                  variant="default"
                  leftSection={<IconPencil size={16} />}
                  loading={saving.isLoading}
                  onClick={() => save({ id: template.id })}
                >
                  Edit as new version
                </Button>
              )}
              {manage && template.draft && (
                <>
                  <Button
                    variant="default"
                    loading={saving.isLoading}
                    onClick={saveDraft}
                  >
                    Save draft
                  </Button>
                  <Button
                    leftSection={<IconRocket size={16} />}
                    loading={acting.isLoading}
                    onClick={async () => {
                      if (!(await saveDraft())) return;
                      // A new version may also move checks not yet started
                      // onto it (TMP-005); ask only when there are some.
                      if (template.unstartedChecks > 0) setPublishing(true);
                      else await act({ id: template.id, action: 'publish' });
                    }}
                  >
                    Publish
                  </Button>
                </>
              )}
              <Button
                variant="default"
                leftSection={<IconCopy size={16} />}
                onClick={() => setDuplicating(true)}
              >
                Duplicate
              </Button>
              <Button
                variant="default"
                leftSection={
                  template.archivedAt ? (
                    <IconRestore size={16} />
                  ) : (
                    <IconArchive size={16} />
                  )
                }
                onClick={() =>
                  act({
                    id: template.id,
                    action: template.archivedAt ? 'restore' : 'archive',
                  })
                }
              >
                {template.archivedAt ? 'Restore' : 'Archive'}
              </Button>
            </>
          )
        }
      />
      <Stack>
        {errors.questions && <Alert color="red">{errors.questions}</Alert>}
        <Card withBorder>
          <Title order={4} mb="md">
            Settings
          </Title>
          <Stack>
            <TextInput
              label="Name"
              required
              disabled={readOnly}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              error={errors.name}
            />
            <Textarea
              label="Description"
              autosize
              minRows={2}
              disabled={readOnly}
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
            <Select
              label={
                purpose === 'reception'
                  ? 'When a reception passes'
                  : 'Completion and approval'
              }
              description={
                purpose === 'reception'
                  ? undefined
                  : 'Separate approval needs a reviewer to approve a submitted check (TMP-011). Schedules can still ask for approval of their own.'
              }
              allowDeselect={false}
              disabled={readOnly}
              data={APPROVAL_MODES.map((mode) => ({
                value: mode,
                label:
                  purpose === 'reception'
                    ? APPROVAL_MODE_LABELS[mode]
                    : mode === 'manual'
                      ? 'Completion and approval are separate'
                      : 'Complete on submission',
              }))}
              value={approvalMode}
              onChange={(value) => setApprovalMode(value as ApprovalMode)}
            />
            {verification && (
              <>
                <Select
                  label="Separation of duties"
                  description="Whoever completes the verification may not approve it."
                  allowDeselect={false}
                  disabled={readOnly || approvalMode !== 'manual'}
                  data={SEPARATION_RULES.map((rule) => ({
                    value: rule,
                    label: SEPARATION_RULE_LABELS[rule],
                  }))}
                  value={separation}
                  onChange={(value) => setSeparation(value as SeparationRule)}
                />
                <Checkbox
                  label="Corrective action must be recorded before verification"
                  disabled={readOnly}
                  checked={requireCorrectiveAction}
                  onChange={(event) =>
                    setRequireCorrectiveAction(event.currentTarget.checked)
                  }
                />
                <Checkbox
                  label="Repair evidence must be added before verification"
                  disabled={readOnly}
                  checked={requireRepairEvidence}
                  onChange={(event) =>
                    setRequireRepairEvidence(event.currentTarget.checked)
                  }
                />
              </>
            )}
            {!verification && purpose !== 'reception' && (
              <Group grow align="flex-start">
                <Select
                  label="Suggested recurrence"
                  description="Pre-filled when a schedule uses this template."
                  placeholder="None"
                  clearable
                  disabled={readOnly}
                  data={SCHEDULE_FREQUENCIES.map((frequency) => ({
                    value: frequency,
                    label: SCHEDULE_FREQUENCY_LABELS[frequency],
                  }))}
                  value={recurrence?.frequency ?? null}
                  onChange={(value) =>
                    setRecurrence(
                      value
                        ? {
                            frequency: value as TemplateRecurrence['frequency'],
                            customUnit: value === 'custom' ? 'week' : null,
                            customCount: value === 'custom' ? 2 : null,
                          }
                        : null,
                    )
                  }
                />
                {recurrence?.frequency === 'custom' && (
                  <Group grow>
                    <NumberInput
                      label="Every"
                      min={1}
                      max={366}
                      disabled={readOnly}
                      value={recurrence.customCount ?? ''}
                      onChange={(value) =>
                        setRecurrence({
                          ...recurrence,
                          customCount: typeof value === 'number' ? value : null,
                        })
                      }
                    />
                    <Select
                      label="Unit"
                      allowDeselect={false}
                      disabled={readOnly}
                      data={SCHEDULE_UNITS.map((unit) => ({
                        value: unit,
                        label: SCHEDULE_UNIT_LABELS[unit],
                      }))}
                      value={recurrence.customUnit}
                      onChange={(value) =>
                        setRecurrence({
                          ...recurrence,
                          customUnit: value as TemplateRecurrence['customUnit'],
                        })
                      }
                    />
                  </Group>
                )}
              </Group>
            )}
          </Stack>
        </Card>
        <Card withBorder>
          <Title order={4} mb={4}>
            Applies to
          </Title>
          <Text size="sm" c="dimmed" mb="md">
            Leave a list empty for no limit. Plant must match the types and
            categories; people must be one of the users, or in one of the
            teams or disciplines (TMP-008).
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <MultiSelect
              label="Plant types"
              placeholder="All plant types"
              searchable
              disabled={readOnly}
              data={options(plantTypes)}
              value={eligibility.plantTypeIds}
              onChange={(value) =>
                setEligibility({ ...eligibility, plantTypeIds: value })
              }
              error={errors['eligibility.plantTypeIds']}
            />
            <MultiSelect
              label="Plant categories"
              placeholder="All categories"
              searchable
              disabled={readOnly}
              data={options(categories)}
              value={eligibility.categoryIds}
              onChange={(value) =>
                setEligibility({ ...eligibility, categoryIds: value })
              }
            />
            <MultiSelect
              label="Disciplines"
              placeholder="Any discipline"
              searchable
              disabled={readOnly}
              data={options(disciplines)}
              value={eligibility.disciplineIds}
              onChange={(value) =>
                setEligibility({ ...eligibility, disciplineIds: value })
              }
            />
            <MultiSelect
              label="Teams"
              placeholder="Any team"
              searchable
              disabled={readOnly}
              data={options(teams)}
              value={eligibility.teamIds}
              onChange={(value) =>
                setEligibility({ ...eligibility, teamIds: value })
              }
            />
            <MultiSelect
              label="Users"
              placeholder="Anyone"
              searchable
              disabled={readOnly}
              data={(users?.items ?? []).map((user) => ({
                value: user.id,
                label: `${user.firstName} ${user.lastName}`,
              }))}
              value={eligibility.userIds}
              onChange={(value) =>
                setEligibility({ ...eligibility, userIds: value })
              }
            />
          </SimpleGrid>
        </Card>
        <Group justify="space-between">
          <Title order={4}>Questions</Title>
          {!readOnly && (
            <Button
              variant="light"
              leftSection={<IconPlus size={16} />}
              onClick={() => setQuestions((list) => [...list, blankQuestion()])}
            >
              Add question
            </Button>
          )}
        </Group>
        {questions.length === 0 && (
          <Card withBorder>
            <Text size="sm" c="dimmed" ta="center">
              No questions yet. A template needs at least one to be published.
            </Text>
          </Card>
        )}
        {questions.map((question, index) => (
          <QuestionCard
            key={question.id}
            question={question}
            index={index}
            total={questions.length}
            earlier={questions.slice(0, index)}
            meters={(meterTypes ?? []).map((meter) => ({
              value: meter.id,
              label: `${meter.name} (${meter.unit})`,
            }))}
            errors={errorsOf(index)}
            readOnly={readOnly}
            onChange={(patch) => update(index, patch)}
            onMove={(offset) => move(index, offset)}
            onRemove={() =>
              setQuestions((list) => list.filter((_, at) => at !== index))
            }
          />
        ))}
      </Stack>
      <PublishModal
        template={template}
        opened={publishing}
        onClose={() => setPublishing(false)}
      />
      <DuplicateModal
        template={template}
        opened={duplicating}
        onClose={() => setDuplicating(false)}
      />
    </>
  );
}

/** Publishing a new version: future checks only, or unstarted ones too (TMP-005). */
function PublishModal({
  template,
  opened,
  onClose,
}: {
  template: CheckTemplateDetail;
  opened: boolean;
  onClose: () => void;
}) {
  const [act, { isLoading }] = useTemplateActionMutation();
  const [apply, setApply] = useState(false);
  const publish = async () => {
    const result = await act({
      id: template.id,
      action: 'publish',
      applyToUnstarted: apply,
    });
    if (!result.error) onClose();
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Publish new version">
      <Stack>
        <Text size="sm">
          {template.unstartedChecks} check
          {template.unstartedChecks === 1 ? ' has' : 's have'} not been started
          yet and use an earlier version.
        </Text>
        <Checkbox
          label="Move them to the new version too"
          description="Started, submitted and completed checks always keep their version."
          checked={apply}
          onChange={(event) => setApply(event.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={publish}>
            Publish
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** A copy of the template as a new Draft (TMP-001). */
function DuplicateModal({
  template,
  opened,
  onClose,
}: {
  template: CheckTemplateDetail;
  opened: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [duplicate, { isLoading }] = useDuplicateTemplateMutation();
  const [name, setName] = useState(`${template.name} (copy)`);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const result = await duplicate({ id: template.id, name });
    if (result.error) {
      const failure = result.error as ApiError;
      return setError(failure.fieldErrors?.[0]?.message ?? failure.message);
    }
    onClose();
    router.push(`/admin/templates/${result.data.id}`);
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Duplicate template">
      <Stack>
        <TextInput
          label="Name of the copy"
          required
          value={name}
          onChange={(event) => {
            setName(event.currentTarget.value);
            setError(null);
          }}
          error={error}
        />
        <Text size="sm" c="dimmed">
          The copy starts as a Draft with the same questions and settings.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={submit}>
            Duplicate
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function TemplatePage() {
  const { id } = useParams<{ id: string }>();
  const { data: template, error } = useTemplateQuery(id);
  if (error) return <ErrorAlert error={error as ApiError} />;
  if (!template)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  // A new draft or a publish starts the editor afresh from the saved version.
  return (
    <TemplateEditor
      key={`${template.draft?.version}-${template.published?.version}`}
      template={template}
    />
  );
}
