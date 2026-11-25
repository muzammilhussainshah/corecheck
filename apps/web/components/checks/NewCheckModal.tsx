'use client';

import { Button, Checkbox, Group, Modal, Select, Stack, Text } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type ApiError, CHECK_PURPOSES } from '@corecheck/shared';
import {
  useCreateCheckMutation,
  usePlantsQuery,
  useTemplateQuery,
  useTemplatesQuery,
} from '../../lib/api';
import { type AssigneeValues, AssigneeFields } from './AssigneeFields';

/**
 * Assigns a check outside any schedule (SCH-004): a published operational,
 * technical or maintenance template on one plant, to a user, team and/or
 * discipline, with an optional due date.
 */
export function NewCheckModal({
  opened,
  onClose,
  plant,
}: {
  opened: boolean;
  onClose: () => void;
  /** Fixed plant, when opened from its profile. */
  plant?: { id: string; label: string };
}) {
  const router = useRouter();
  const [create, { isLoading }] = useCreateCheckMutation();
  const { data: templates } = useTemplatesQuery();
  const [search, setSearch] = useState('');
  const { data: plants } = usePlantsQuery(
    { page: 1, pageSize: 50, search: search || undefined },
    { skip: !!plant },
  );
  const [plantId, setPlantId] = useState<string | null>(plant?.id ?? null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const { data: template } = useTemplateQuery(templateId ?? '', {
    skip: !templateId,
  });
  const [dueOn, setDueOn] = useState('');
  // The template's setting until the user changes it (TMP-011).
  const [reviewChoice, setReviewChoice] = useState<boolean | null>(null);
  const requiresReview =
    reviewChoice ?? template?.published?.approvalMode === 'manual';
  const [assignee, setAssignee] = useState<AssigneeValues>({
    assigneeUserId: null,
    assigneeTeamId: null,
    assigneeDisciplineId: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const usable = (templates ?? []).filter(
    (item) =>
      CHECK_PURPOSES.includes(item.purpose) &&
      item.publishedVersion &&
      !item.archivedAt,
  );
  const submit = async () => {
    setErrors({});
    const result = await create({
      plantId: plantId ?? '',
      templateId: templateId ?? '',
      dueOn: dueOn || undefined,
      requiresReview,
      ...assignee,
    });
    if (result.error)
      return setErrors(
        Object.fromEntries(
          ((result.error as ApiError).fieldErrors ?? []).map((item) => [
            item.field,
            item.message,
          ]),
        ),
      );
    onClose();
    router.push(`/checks/${result.data.id}`);
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Assign a check" size="lg">
      <Stack>
        {plant ? (
          <Text size="sm">
            Plant: <b>{plant.label}</b>
          </Text>
        ) : (
          <Select
            label="Plant"
            required
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            data={(plants?.items ?? [])
              .filter((item) => !item.archivedAt)
              .map((item) => ({
                value: item.id,
                label: `${item.assetId} ${item.name} (${item.site.name})`,
              }))}
            value={plantId}
            onChange={setPlantId}
            error={errors.plantId}
          />
        )}
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
          onChange={(value) => {
            setTemplateId(value);
            setReviewChoice(null);
          }}
          error={errors.templateId}
        />
        <Text size="sm" fw={500} mb={-8}>
          Assigned to
        </Text>
        <AssigneeFields value={assignee} onChange={setAssignee} error={errors.assigneeUserId} />
        <DateInput
          label="Due date"
          placeholder="No due date"
          clearable
          valueFormat="D MMM YYYY"
          minDate={new Date()}
          value={dueOn || null}
          onChange={(value) => setDueOn(value ?? '')}
          error={errors.dueOn}
        />
        <Checkbox
          label="Needs approval after submission"
          checked={requiresReview}
          onChange={(event) => setReviewChoice(event.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={submit}>
            Assign check
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
