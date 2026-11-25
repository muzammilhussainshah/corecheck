import {
  CHECK_STATUS_LABELS,
  type CheckAssignee,
  type CheckDisplayStatus,
  DEFECT_SEVERITY_LABELS,
  DEFECT_STATUS_LABELS,
  type DefectSeverity,
  type DefectStatus,
  SCHEDULE_STATE_LABELS,
  type ScheduleState,
  VERIFICATION_STATE_LABELS,
  type VerificationState,
} from '@corecheck/shared';
import { Pill, type Tone } from '@corecheck/ui';

const CHECK_TONES: Record<CheckDisplayStatus, Tone> = {
  scheduled: 'neutral',
  due: 'info',
  in_progress: 'info',
  submitted: 'warning',
  returned: 'warning',
  completed: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  overdue: 'danger',
};

export const CheckStatusBadge = ({ status }: { status: CheckDisplayStatus }) => (
  <Pill tone={CHECK_TONES[status]}>{CHECK_STATUS_LABELS[status]}</Pill>
);

const SEVERITY_TONES: Record<DefectSeverity, Tone> = {
  minor: 'warning',
  major: 'danger',
  critical: 'danger',
};

export const SeverityBadge = ({ severity }: { severity: DefectSeverity }) => (
  <Pill tone={SEVERITY_TONES[severity]}>
    {severity === 'critical' ? '⚠ ' : ''}
    {DEFECT_SEVERITY_LABELS[severity]}
  </Pill>
);

const DEFECT_TONES: Record<DefectStatus, Tone> = {
  open: 'danger',
  in_progress: 'warning',
  closed: 'success',
};

export const DefectStatusBadge = ({ status }: { status: DefectStatus }) => (
  <Pill tone={DEFECT_TONES[status]}>{DEFECT_STATUS_LABELS[status]}</Pill>
);

const VERIFICATION_TONES: Record<VerificationState, Tone> = {
  not_started: 'neutral',
  in_progress: 'info',
  awaiting_approval: 'warning',
  approved: 'success',
  returned: 'warning',
};

export const VerificationBadge = ({ state }: { state: VerificationState }) => (
  <Pill tone={VERIFICATION_TONES[state]}>{VERIFICATION_STATE_LABELS[state]}</Pill>
);

const SCHEDULE_TONES: Record<ScheduleState, Tone> = {
  active: 'success',
  paused: 'warning',
  plant_offline: 'danger',
  archived: 'neutral',
};

export const ScheduleStateBadge = ({ state }: { state: ScheduleState }) => (
  <Pill tone={SCHEDULE_TONES[state]}>{SCHEDULE_STATE_LABELS[state]}</Pill>
);

/** "Olga Smith · Team A · Electrical", or "Unassigned". */
export const assigneeText = (assignee: CheckAssignee): string =>
  [
    assignee.user?.name,
    assignee.team && `Team ${assignee.team.name}`,
    assignee.discipline && assignee.discipline.name,
  ]
    .filter(Boolean)
    .join(' · ') || 'Unassigned';
