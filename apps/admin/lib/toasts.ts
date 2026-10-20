import type { SuccessMessage } from '@corecheck/ui';

/** The toast each internal-portal action shows when it succeeds. */
export const SUCCESS_MESSAGES: Record<string, SuccessMessage> = {
  // With two-factor on, sign-in finishes at the code step instead.
  login: (_arg, result) =>
    result.next === 'done' ? 'Signed in successfully.' : null,
  mfaConfirm: 'Two-factor authentication is set up.',
  mfaVerify: 'Signed in successfully.',
  changePassword: 'Your password has been changed.',
  logout: 'You have signed out.',
  createOrganisation: (_arg, result) =>
    `${result.organisation.name} has been created.`,
  updateOrganisation: 'Organisation saved.',
  changeOrganisationStatus: (_arg, result) =>
    `${result.name} is now ${result.status}.`,
  resetAdminPin: 'Temporary PIN issued.',
  unlockAdmin: (_arg, result) =>
    `${result.firstName} ${result.lastName} can sign in again.`,
  createStaff: (_arg, result) => `${result.staff.name} has been added.`,
  updateStaff: 'Staff role updated.',
  setStaffActive: (arg) =>
    arg.active ? 'Staff member enabled.' : 'Staff member disabled.',
  resetStaffCredentials: 'Sign-in details reset.',
};
