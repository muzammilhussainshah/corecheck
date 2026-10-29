import { Group } from '@mantine/core';
import {
  PLANT_STATUS_LABELS,
  type PlantStatus,
  RESTRICTION_REASON_LABELS,
  type RestrictionReason,
} from '@corecheck/shared';
import { Pill, type Tone } from '@corecheck/ui';

const TONES: Record<PlantStatus | 'archived', Tone> = {
  pending_reception: 'info',
  awaiting_approval: 'warning',
  approved: 'success',
  restricted: 'danger',
  archived: 'neutral',
};

/**
 * A plant's primary status, written out (never colour alone), with its
 * restriction reason beside it when it has one (PLC-002).
 */
export const PlantStatusBadge = ({
  status,
  archived = false,
  reason,
}: {
  status: PlantStatus;
  archived?: boolean;
  reason?: RestrictionReason | null;
}) => {
  const key = archived ? 'archived' : status;
  return (
    <Group gap={6} wrap="nowrap">
      <Pill tone={TONES[key]}>{PLANT_STATUS_LABELS[key]}</Pill>
      {!archived && reason && (
        <Pill tone="neutral">{RESTRICTION_REASON_LABELS[reason]}</Pill>
      )}
    </Group>
  );
};
