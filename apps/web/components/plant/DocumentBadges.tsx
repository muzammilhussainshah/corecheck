import { Text } from '@mantine/core';
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
