import { Box } from '@mantine/core';
import type { ReactNode } from 'react';
import {
  ORGANISATION_STATUS_LABELS,
  type OrganisationStatus,
  USER_STATUS_LABELS,
  type UserStatus,
} from '@corecheck/shared';

/** CoreStock's status pill colours: text on a pale tint of the same hue. */
export const TONES = {
  success: { color: '#087442', background: '#EDFCF2' },
  warning: { color: '#B54708', background: '#FFFAEB' },
  danger: { color: '#B6271F', background: '#FEF3F2' },
  neutral: { color: '#364152', background: '#EEF2F6' },
  info: { color: '#175CD3', background: '#EFF8FF' },
} as const;

export type Tone = keyof typeof TONES;

/**
 * A rounded status pill. Status is always written out, never colour alone
 * (DSH-AC-04, NFR-006).
 */
export const Pill = ({
  tone = 'neutral',
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) => (
  <Box
    component="span"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 12px',
      borderRadius: 999,
      fontSize: 13,
      fontWeight: 500,
      lineHeight: 1.4,
      whiteSpace: 'nowrap',
      color: TONES[tone].color,
      backgroundColor: TONES[tone].background,
    }}
  >
    {children}
  </Box>
);

const USER_TONES: Record<UserStatus, Tone> = {
  active: 'success',
  inactive: 'neutral',
  locked: 'danger',
};

const ORGANISATION_TONES: Record<OrganisationStatus, Tone> = {
  active: 'success',
  suspended: 'warning',
  archived: 'neutral',
};

export const UserStatusBadge = ({ status }: { status: UserStatus }) => (
  <Pill tone={USER_TONES[status]}>{USER_STATUS_LABELS[status]}</Pill>
);

export const OrganisationStatusBadge = ({
  status,
}: {
  status: OrganisationStatus;
}) => (
  <Pill tone={ORGANISATION_TONES[status]}>
    {ORGANISATION_STATUS_LABELS[status]}
  </Pill>
);

export const ArchivedBadge = () => <Pill tone="neutral">Archived</Pill>;
