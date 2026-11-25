import type { CheckAssignee } from '@corecheck/shared';

/** "Olga Smith; Team Lifting; Electrical", or "Unassigned". */
export const assigneeLabel = (assignee: CheckAssignee): string =>
  [
    assignee.user?.name,
    assignee.team && `Team ${assignee.team.name}`,
    assignee.discipline?.name,
  ]
    .filter(Boolean)
    .join('; ') || 'Unassigned';
