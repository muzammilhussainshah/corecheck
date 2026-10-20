import { createApi } from '@reduxjs/toolkit/query/react';
import {
  type ApiError,
  type Area,
  type AuditEvent,
  type ChangePinInput,
  type CreateAreaInput,
  type CreateDisciplineInput,
  type CreateRoleInput,
  type CreateSiteInput,
  type CreateTeamInput,
  type CreateUserInput,
  type CustomerLoginInput,
  type Discipline,
  type DuplicateRoleInput,
  ERROR_CODES,
  type ListAuditQuery,
  type ListUsersQuery,
  type LoginResponse,
  type MeResponse,
  type Paginated,
  type PocCheck,
  type PocCreateCheckInput,
  type PocPullResponse,
  type RoleSummary,
  type SeatUsage,
  type Site,
  type Team,
  type UpdateRoleInput,
  type UpdateSiteInput,
  type UpdateUserInput,
  type UserDetail,
  type UserSummary,
  type UserWithCredentials,
} from '@corecheck/shared';
import {
  axiosBaseQuery,
  cleanParams,
  createHttpClient,
  SESSION_ENDING_CODES,
} from '@corecheck/ui';

const PUBLIC_PATHS = ['/login'];

/**
 * Sends the user back to sign in when their session has ended, or to the
 * PIN change screen when a temporary PIN is still in use.
 */
const handleSessionErrors = (error: ApiError): void => {
  // A full page load on purpose: it discards every cached response of the
  // ended session, whoever signs in next.
  /* eslint-disable @next/next/no-location-assign-relative-destination */
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (
    SESSION_ENDING_CODES.includes(error.code) &&
    !PUBLIC_PATHS.includes(path)
  ) {
    const next = encodeURIComponent(path + window.location.search);
    window.location.assign(`/login?reason=${error.code}&next=${next}`);
  } else if (
    error.code === ERROR_CODES.PIN_CHANGE_REQUIRED &&
    path !== '/change-pin'
  ) {
    window.location.assign('/change-pin');
  }
  /* eslint-enable @next/next/no-location-assign-relative-destination */
};

type StructureKind = 'sites' | 'teams' | 'disciplines';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: axiosBaseQuery(createHttpClient(), handleSessionErrors),
  // Ask the server again whenever a screen opens or the tab regains focus,
  // so suspension, permission changes and ended sessions show at once
  // instead of stale cached data.
  refetchOnMountOrArgChange: true,
  refetchOnFocus: true,
  tagTypes: [
    'Me',
    'User',
    'Seat',
    'Role',
    'Site',
    'Area',
    'Team',
    'Discipline',
    'Audit',
    'Poc',
  ],
  endpoints: (build) => ({
    // ------------------------------------------------------------ session
    me: build.query<MeResponse, void>({
      query: () => ({ url: '/auth/me' }),
      providesTags: ['Me'],
    }),
    login: build.mutation<LoginResponse, CustomerLoginInput>({
      query: (body) => ({
        url: '/auth/login',
        method: 'POST',
        body: { ...body, client: 'web' },
      }),
    }),
    changePin: build.mutation<MeResponse, ChangePinInput>({
      query: (body) => ({ url: '/auth/change-pin', method: 'POST', body }),
      // Store the new session state at once: the app must not see the old
      // 'PIN must be changed' flag and send the user back to this screen.
      async onQueryStarted(_body, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(api.util.upsertQueryData('me', undefined, data));
        } catch {
          // The failure is shown by the form and its toast.
        }
      },
    }),
    logout: build.mutation<void, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
    }),

    // -------------------------------------------------------------- users
    users: build.query<Paginated<UserSummary>, ListUsersQuery>({
      query: (params) => ({
        url: '/users',
        params: cleanParams({ ...params }),
      }),
      providesTags: ['User'],
    }),
    user: build.query<UserDetail, string>({
      query: (id) => ({ url: `/users/${id}` }),
      providesTags: (_result, _error, id) => [{ type: 'User', id }],
    }),
    seatUsage: build.query<SeatUsage, void>({
      query: () => ({ url: '/users/seat-usage' }),
      providesTags: ['Seat'],
    }),
    createUser: build.mutation<UserWithCredentials, CreateUserInput>({
      query: (body) => ({ url: '/users', method: 'POST', body }),
      invalidatesTags: ['User', 'Seat', 'Role', 'Team', 'Discipline'],
    }),
    updateUser: build.mutation<UserDetail, { id: string } & UpdateUserInput>({
      query: ({ id, ...body }) => ({
        url: `/users/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['User', 'Role', 'Team', 'Discipline'],
    }),
    userAction: build.mutation<
      UserDetail | UserWithCredentials,
      {
        id: string;
        action: 'deactivate' | 'reactivate' | 'reset-pin' | 'unlock';
      }
    >({
      query: ({ id, action }) => ({
        url: `/users/${id}/${action}`,
        method: 'POST',
      }),
      invalidatesTags: ['User', 'Seat', 'Role'],
    }),

    // -------------------------------------------------------------- roles
    roles: build.query<RoleSummary[], { includeArchived?: boolean } | void>({
      query: (args) => ({
        url: '/roles',
        params: args?.includeArchived ? { includeArchived: 'true' } : undefined,
      }),
      providesTags: ['Role'],
    }),
    role: build.query<RoleSummary, string>({
      query: (id) => ({ url: `/roles/${id}` }),
      providesTags: (_result, _error, id) => [{ type: 'Role', id }],
    }),
    createRole: build.mutation<RoleSummary, CreateRoleInput>({
      query: (body) => ({ url: '/roles', method: 'POST', body }),
      invalidatesTags: ['Role'],
    }),
    duplicateRole: build.mutation<
      RoleSummary,
      { id: string } & DuplicateRoleInput
    >({
      query: ({ id, ...body }) => ({
        url: `/roles/${id}/duplicate`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Role'],
    }),
    updateRole: build.mutation<RoleSummary, { id: string } & UpdateRoleInput>({
      query: ({ id, ...body }) => ({
        url: `/roles/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Role', 'Me'],
    }),
    setRoleArchived: build.mutation<
      RoleSummary,
      { id: string; archived: boolean }
    >({
      query: ({ id, archived }) => ({
        url: `/roles/${id}/${archived ? 'archive' : 'restore'}`,
        method: 'POST',
      }),
      invalidatesTags: ['Role'],
    }),

    // ------------------------------------------------ organisation structure
    sites: build.query<Site[], { includeArchived?: boolean } | void>({
      query: (args) => ({
        url: '/sites',
        params: args?.includeArchived ? { includeArchived: 'true' } : undefined,
      }),
      providesTags: ['Site'],
    }),
    teams: build.query<Team[], { includeArchived?: boolean } | void>({
      query: (args) => ({
        url: '/teams',
        params: args?.includeArchived ? { includeArchived: 'true' } : undefined,
      }),
      providesTags: ['Team'],
    }),
    disciplines: build.query<
      Discipline[],
      { includeArchived?: boolean } | void
    >({
      query: (args) => ({
        url: '/disciplines',
        params: args?.includeArchived ? { includeArchived: 'true' } : undefined,
      }),
      providesTags: ['Discipline'],
    }),
    createStructure: build.mutation<
      Site | Team | Discipline,
      {
        kind: StructureKind;
        body: CreateSiteInput | CreateTeamInput | CreateDisciplineInput;
      }
    >({
      query: ({ kind, body }) => ({ url: `/${kind}`, method: 'POST', body }),
      invalidatesTags: ['Site', 'Team', 'Discipline'],
    }),
    updateStructure: build.mutation<
      Site | Team | Discipline,
      {
        kind: StructureKind;
        id: string;
        body:
          UpdateSiteInput | Partial<CreateTeamInput> | CreateDisciplineInput;
      }
    >({
      query: ({ kind, id, body }) => ({
        url: `/${kind}/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Site', 'Team', 'Discipline', 'User'],
    }),
    setStructureArchived: build.mutation<
      unknown,
      { kind: StructureKind | 'areas'; id: string; archived: boolean }
    >({
      query: ({ kind, id, archived }) => ({
        url: `/${kind}/${id}/${archived ? 'archive' : 'restore'}`,
        method: 'POST',
      }),
      invalidatesTags: ['Site', 'Team', 'Discipline', 'Area'],
    }),
    areas: build.query<Area[], { siteId: string; includeArchived?: boolean }>({
      query: ({ siteId, includeArchived }) => ({
        url: `/sites/${siteId}/areas`,
        params: includeArchived ? { includeArchived: 'true' } : undefined,
      }),
      providesTags: ['Area'],
    }),
    createArea: build.mutation<Area, { siteId: string } & CreateAreaInput>({
      query: ({ siteId, ...body }) => ({
        url: `/sites/${siteId}/areas`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Area', 'Site'],
    }),
    updateArea: build.mutation<Area, { id: string } & CreateAreaInput>({
      query: ({ id, ...body }) => ({
        url: `/areas/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Area'],
    }),

    // -------------------------------------------------------------- audit
    auditEvents: build.query<Paginated<AuditEvent>, ListAuditQuery>({
      query: (params) => ({
        url: '/audit-events',
        params: cleanParams({ ...params }),
      }),
      providesTags: ['Audit'],
    }),

    // ------------------------------------------------- offline sync (PoC)
    pocChecks: build.query<PocPullResponse, void>({
      query: () => ({ url: '/poc/sync' }),
      providesTags: ['Poc'],
    }),
    createPocCheck: build.mutation<PocCheck, PocCreateCheckInput>({
      query: (body) => ({ url: '/poc/checks', method: 'POST', body }),
      invalidatesTags: ['Poc'],
    }),
  }),
});

export const {
  useMeQuery,
  useLoginMutation,
  useChangePinMutation,
  useLogoutMutation,
  useUsersQuery,
  useUserQuery,
  useSeatUsageQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useUserActionMutation,
  useRolesQuery,
  useRoleQuery,
  useCreateRoleMutation,
  useDuplicateRoleMutation,
  useUpdateRoleMutation,
  useSetRoleArchivedMutation,
  useSitesQuery,
  useTeamsQuery,
  useDisciplinesQuery,
  useCreateStructureMutation,
  useUpdateStructureMutation,
  useSetStructureArchivedMutation,
  useAreasQuery,
  useCreateAreaMutation,
  useUpdateAreaMutation,
  useAuditEventsQuery,
  usePocChecksQuery,
  useCreatePocCheckMutation,
} = api;
