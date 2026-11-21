import { Group, Text } from '@mantine/core';
import {
  DOCUMENT_STATE_LABELS,
  type DocumentState,
  PLANT_COMPLIANCE_LABELS,
  type PlantComplianceState,
} from '@corecheck/shared';
import { Pill, type Tone } from '@corecheck/ui';

const STATE_TONES: Record<DocumentState, Tone> = {
  valid: 'success',
  approaching_expiry: 'warning',
  awaiting_verification: 'info',
  expired: 'danger',
  missing: 'danger',
  rejected: 'danger',
  archived: 'neutral',
};

/** A document's status, written out (DOC-005, never colour alone). */
export const DocumentStateBadge = ({ state }: { state: DocumentState }) => (
  <Pill tone={STATE_TONES[state]}>{DOCUMENT_STATE_LABELS[state]}</Pill>
);

/**
 * A document's status plus what it would otherwise hide (Milestone 2 bug 6):
 * an expired document still awaiting verification says so, and an
 * unverified one expiring soon carries that warning too. The plant profile
 * and the Documents register both show it, so they always agree.
 */
export const DocumentStatus = ({
  state,
  awaitingVerification,
  expiresSoon,
}: {
  state: DocumentState;
  awaitingVerification: boolean;
  expiresSoon: boolean;
}) => (
  <Group gap={4} wrap="wrap">
    <DocumentStateBadge state={state} />
    {awaitingVerification && state === 'expired' && (
      <DocumentStateBadge state="awaiting_verification" />
    )}
    {expiresSoon && state === 'awaiting_verification' && (
      <DocumentStateBadge state="approaching_expiry" />
    )}
  </Group>
);

const COMPLIANCE_TONES: Record<PlantComplianceState, Tone> = {
  compliant: 'success',
  expiring: 'warning',
  non_compliant: 'danger',
  not_required: 'neutral',
};

/** A plant's standing against its mandatory documents (PLR-001). */
export const ComplianceBadge = ({ state }: { state: PlantComplianceState }) =>
  state === 'not_required' ? (
    <Text size="sm" c="dimmed">
      —
    </Text>
  ) : (
    <Pill tone={COMPLIANCE_TONES[state]}>{PLANT_COMPLIANCE_LABELS[state]}</Pill>
  );
