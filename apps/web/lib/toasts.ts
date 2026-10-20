import type { SuccessMessage } from '@corecheck/ui';

const USER_ACTIONS: Record<string, string> = {
  deactivate: 'User deactivated. They can no longer sign in.',
  reactivate: 'User reactivated.',
  'reset-pin': 'Temporary PIN issued.',
  unlock: 'User unlocked. They can sign in again.',
};

/** The toast each customer-app action shows when it succeeds. */
export const SUCCESS_MESSAGES: Record<string, SuccessMessage> = {
  login: 'Signed in successfully.',
  logout: 'You have signed out.',
  changePin: 'Your PIN has been changed.',
  createUser: (_arg, result) =>
    `${result.user.firstName} ${result.user.lastName} has been added.`,
  updateUser: 'Changes saved. They apply from the user’s next action.',
  userAction: (arg) => USER_ACTIONS[arg.action] ?? 'Done.',
  createRole: (_arg, result) => `Role “${result.name}” created.`,
  duplicateRole: (_arg, result) => `Role “${result.name}” created.`,
  updateRole:
    'Role saved. Holders get the new permissions on their next action.',
  setRoleArchived: (arg) =>
    arg.archived ? 'Role archived.' : 'Role restored.',
  createStructure: (_arg, result) => `${result.name} added.`,
  updateStructure: 'Changes saved.',
  setStructureArchived: (arg) => (arg.archived ? 'Archived.' : 'Restored.'),
  createArea: (_arg, result) => `Area “${result.name}” added.`,
  updateArea: 'Area saved.',
  createPocCheck: 'Check created.',
};
