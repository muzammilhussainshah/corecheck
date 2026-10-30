'use client';

import { Button, Card, Checkbox, Group, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import {
  PLANT_DETAIL_LABELS,
  PLANT_DETAILS,
  type PlantDetailKey,
} from '@corecheck/shared';
import { COLORS } from '@corecheck/ui';
import {
  usePlantSettingsQuery,
  useSavePlantSettingsMutation,
} from '../../lib/api';

/** Plant details the organisation makes mandatory before approval. */
export function RequiredPlantDetails() {
  const { data } = usePlantSettingsQuery();
  const [save, { isLoading }] = useSavePlantSettingsMutation();
  const [draft, setDraft] = useState<PlantDetailKey[] | null>(null);
  const required = draft ?? data?.requiredFields ?? [];

  return (
    <Card withBorder radius="md" padding="lg">
      <Stack gap="sm">
        <div>
          <Text fw={600} c={COLORS.title}>
            Required before approval
          </Text>
          <Text size="sm" c={COLORS.muted}>
            These can be added after registration. A reception cannot approve
            plant automatically while a ticked detail is missing.
          </Text>
        </div>
        <Checkbox.Group
          value={required}
          onChange={(value) => setDraft(value as PlantDetailKey[])}
        >
          <Group gap="lg">
            {PLANT_DETAILS.map((key) => (
              <Checkbox
                key={key}
                value={key}
                label={PLANT_DETAIL_LABELS[key]}
              />
            ))}
          </Group>
        </Checkbox.Group>
        <Group justify="flex-end">
          <Button
            loading={isLoading}
            onClick={() => void save({ requiredFields: required })}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
