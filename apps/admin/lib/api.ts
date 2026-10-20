import { createApi } from '@reduxjs/toolkit/query/react';
import {
  type ApiError,
  type AuditEvent,
  type ChangeStaffPasswordInput,
  type CreateOrganisationInput,
  type CreateOrganisationResponse,
  type CreateStaffInput,
  ERROR_CODES,
  type IssuedCredentials,
  type ListAuditQuery,
  type ListOrganisationsQuery,
  type MfaSetupResponse,
  type OrganisationAdmin,
  type OrganisationDetail,
  type OrganisationSummary,
  type Paginated,
  type StaffLoginInput,
  type StaffLoginResponse,
  type StaffMe,
  type StaffMember,
  type StaffWithPassword,
  type UpdateOrganisationInput,
  type UpdateStaffInput,
} from '@corecheck/shared';
import {
  axiosBaseQuery,
  cleanParams,
  createHttpClient,
  SESSION_ENDING_CODES,
} from '@corecheck/ui';

/**
 * Sends staff to the right step: sign in again when the session has ended,
 * or complete MFA / the password change when the API asks for it.
 */
const handleSessionErrors = (error: ApiError): void => {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  // Full page loads on purpose: they discard every cached response.
  /* eslint-disable @next/next/no-location-assign-relative-destination */
  if (SESSION_ENDING_CODES.includes(error.code) && path !== '/login') {
    window.location.assign(`/login?reason=${error.code}`);
  } else if (
    (error.code === ERROR_CODES.MFA_REQUIRED ||
      error.code === ERROR_CODES.MFA_SETUP_REQUIRED) &&
    path !== '/mfa'
  ) {
    window.location.assign('/mfa');
  } else if (
    error.code === ERROR_CODES.PASSWORD_CHANGE_REQUIRED &&
    path !== '/change-password'
  ) {
    window.location.assign('/change-password');
  }
  /* eslint-enable @next/next/no-location-assign-relative-destination */
};

type StatusAction = 'suspend' | 'activate' | 'archive';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: axiosBaseQuery(createHttpClient(), handleSessionErrors),
  // Ask the server again whenever a screen opens or the tab regains focus,
  // so suspension, permission changes and ended sessions show at once
  // instead of stale cached data.
  refetchOnMountOrArgChange: true,
  refetchOnFocus: true,
  tagTypes: ['Me', 'Organisation', 'Admins', 'Staff', 'Audit'],
  endpoints: (build) => ({
    me: build.query<StaffMe, void>({
      query: () => ({ url: '/platform/auth/me' }),
      providesTags: ['Me'],
    }),
    login: build.mutation<StaffLoginResponse, StaffLoginInput>({
      query: (body) => ({ url: '/platform/auth/login', method: 'POST', body }),
    }),
    mfaSetup: build.mutation<MfaSetupResponse, void>({
      query: () => ({ url: '/platform/auth/mfa/setup', method: 'POST' }),
    }),
    mfaConfirm: build.mutation<StaffMe, { code: string }>({
      query: (body) => ({
        url: '/platform/auth/mfa/confirm',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Me'],
    }),
    mfaVerify: build.mutation<StaffMe, { code: string }>({
      query: (body) => ({
        url: '/platform/auth/mfa/verify',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Me'],
    }),
    changePassword: build.mutation<StaffMe, ChangeStaffPasswordInput>({
      query: (body) => ({
        url: '/platform/auth/change-password',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Me'],
    }),
    logout: build.mutation<void, void>({
      query: () => ({ url: '/platform/auth/logout', method: 'POST' }),
    }),

    organisations: build.query<
      Paginated<OrganisationSummary>,
      ListOrganisationsQuery
    >({
      query: (params) => ({
        url: '/platform/organisations',
        params: cleanParams({ ...params }),
      }),
      providesTags: ['Organisation'],
    }),
    organisation: build.query<OrganisationDetail, string>({
      query: (id) => ({ url: `/platform/organisations/${id}` }),
      providesTags: ['Organisation'],
    }),
    createOrganisation: build.mutation<
      CreateOrganisationResponse,
      CreateOrganisationInput
    >({
      query: (body) => ({
        url: '/platform/organisations',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Organisation'],
    }),
    updateOrganisation: build.mutation<
      OrganisationDetail,
      { id: string } & UpdateOrganisationInput
    >({
      query: ({ id, ...body }) => ({
        url: `/platform/organisations/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Organisation'],
    }),
    changeOrganisationStatus: build.mutation<
      OrganisationDetail,
      { id: string; action: StatusAction; reason?: string }
    >({
      query: ({ id, action, reason }) => ({
        url: `/platform/organisations/${id}/${action}`,
        method: 'POST',
        body: reason ? { reason } : {},
      }),
      invalidatesTags: ['Organisation', 'Audit'],
    }),
    organisationAdmins: build.query<OrganisationAdmin[], string>({
      query: (id) => ({ url: `/platform/organisations/${id}/admins` }),
      providesTags: ['Admins'],
    }),
    resetAdminPin: build.mutation<
      { admin: OrganisationAdmin; credentials: IssuedCredentials },
      { orgId: string; userId: string }
    >({
      query: ({ orgId, userId }) => ({
        url: `/platform/organisations/${orgId}/admins/${userId}/reset-pin`,
        method: 'POST',
      }),
      invalidatesTags: ['Admins', 'Audit'],
    }),
    unlockAdmin: build.mutation<
      OrganisationAdmin,
      { orgId: string; userId: string }
    >({
      query: ({ orgId, userId }) => ({
        url: `/platform/organisations/${orgId}/admins/${userId}/unlock`,
        method: 'POST',
      }),
      invalidatesTags: ['Admins', 'Audit'],
    }),

    staff: build.query<StaffMember[], void>({
      query: () => ({ url: '/platform/staff' }),
      providesTags: ['Staff'],
    }),
    createStaff: build.mutation<StaffWithPassword, CreateStaffInput>({
      query: (body) => ({ url: '/platform/staff', method: 'POST', body }),
      invalidatesTags: ['Staff'],
    }),
    updateStaff: build.mutation<StaffMember, { id: string } & UpdateStaffInput>(
      {
        query: ({ id, ...body }) => ({
          url: `/platform/staff/${id}`,
          method: 'PATCH',
          body,
        }),
        invalidatesTags: ['Staff'],
      },
    ),
    setStaffActive: build.mutation<
      StaffMember,
      { id: string; active: boolean }
    >({
      query: ({ id, active }) => ({
        url: `/platform/staff/${id}/${active ? 'enable' : 'disable'}`,
        method: 'POST',
      }),
      invalidatesTags: ['Staff'],
    }),
    resetStaffCredentials: build.mutation<
      StaffWithPassword,
      { id: string; resetMfa: boolean }
    >({
      query: ({ id, resetMfa }) => ({
        url: `/platform/staff/${id}/reset-credentials`,
        method: 'POST',
        body: { resetMfa },
      }),
      invalidatesTags: ['Staff'],
    }),

    auditEvents: build.query<Paginated<AuditEvent>, ListAuditQuery>({
      query: (params) => ({
        url: '/platform/audit-events',
        params: cleanParams({ ...params }),
      }),
      providesTags: ['Audit'],
    }),
  }),
});

export const {
  useMeQuery,
  useLoginMutation,
  useMfaSetupMutation,
  useMfaConfirmMutation,
  useMfaVerifyMutation,
  useChangePasswordMutation,
  useLogoutMutation,
  useOrganisationsQuery,
  useOrganisationQuery,
  useCreateOrganisationMutation,
  useUpdateOrganisationMutation,
  useChangeOrganisationStatusMutation,
  useOrganisationAdminsQuery,
  useResetAdminPinMutation,
  useUnlockAdminMutation,
  useStaffQuery,
  useCreateStaffMutation,
  useUpdateStaffMutation,
  useSetStaffActiveMutation,
  useResetStaffCredentialsMutation,
  useAuditEventsQuery,
} = api;
