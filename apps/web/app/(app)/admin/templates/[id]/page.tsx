'use client';

import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Center,
  Group,
  Loader,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconArchive,
  IconArrowDown,
  IconArrowUp,
  IconPencil,
  IconPlus,
  IconRestore,
  IconRocket,
  IconTrash,
} from '@tabler/icons-react';
import { useParams } from 'next/navigation';
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
  type TemplateQuestion,
} from '@corecheck/shared';
import { ErrorAlert, Pill } from '@corecheck/ui';
import { AppPageHeader } from '../../../../../components/AppPageHeader';
import {
  useSaveTemplateDraftMutation,
  useTemplateActionMutation,
  useTemplateQuery,
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
  offlineOnFail: false,
  defectSeverity: null,
});

const toNumber = (value: string | number): number | null =>
  typeof value === 'number' ? value : null;

function QuestionCard({
  question,
  index,
  total,
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
              label="Defect severity on a fail"
              description="Saved with the template. Defects are raised from it once the defects workflow is live."
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
      </Stack>
    </Card>
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
  const [errors, setErrors] = useState<Record<string, string>>({});

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
          { label: 'Reception templates', href: '/admin/templates' },
          { label: template.name },
        ]}
        title={
          <Group gap="sm">
            {template.name}
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
                      if (await saveDraft())
                        await act({ id: template.id, action: 'publish' });
                    }}
                  >
                    Publish
                  </Button>
                </>
              )}
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
              label="When a reception passes"
              allowDeselect={false}
              disabled={readOnly}
              data={APPROVAL_MODES.map((mode) => ({
                value: mode,
                label: APPROVAL_MODE_LABELS[mode],
              }))}
              value={approvalMode}
              onChange={(value) => setApprovalMode(value as ApprovalMode)}
            />
          </Stack>
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
    </>
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
