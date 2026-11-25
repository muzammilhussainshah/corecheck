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
  type AssignCheckInput,
  type AssignDefectInput,
  type CheckDetail,
  type CheckSchedule,
  type CheckSummary,
  type CreateCheckInput,
  type CreateScheduleInput,
  type DefectDetail,
  type DefectSummary,
  type ListChecksQuery,
  type ListDefectsQuery,
  type NotificationList,
  type RecordDefectWorkInput,
  type ReviewCheckInput,
  type SaveCheckAnswersInput,
  type TemplatePurpose,
  type TemplateImportDetail,
  type TemplateImportSummary,
  type UpdateScheduleInput,
  type WorkSummary,
  type DashboardSummary,
  type CheckTemplateDetail,
  type CorrectMeterReadingInput,
  type CreateMeterReadingInput,
  type PlantImportDetail,
  type PlantSettings,
  type PlantImportSummary,
  type PlantMeters,
  type UpdateImportRowInput,
  type CheckTemplateSummary,
  type CreatePlantInput,
  type CreateTemplateInput,
  type PlantReception,
  type ReceptionCheck,
  type SaveReceptionAnswersInput,
  type SaveTemplateDraftInput,
  type DocumentRegisterRow,
  type ListDocumentsQuery,
  type ListPlantsQuery,
  type PlantDocument,
  type PlantDocuments,
  type PlantDetail,
  type PlantDuplicates,
  type PlantDuplicatesQuery,
  type PlantSaved,
  type PlantSummary,
  type PlantType,
  type RestrictPlantInput,
  type ReturnToServiceInput,
  type UpdatePlantInput,
  type PocPullResponse,
  type RoleSummary,
  type SeatUsage,
  type SetRequiredDocumentsInput,
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
import { loginUrl } from './return-path';

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
    // Come back to this page after signing in again (e.g. a scanned QR code).
    window.location.assign(loginUrl(error.code));
  } else if (
    error.code === ERROR_CODES.PIN_CHANGE_REQUIRED &&
    path !== '/change-pin'
  ) {
    window.location.assign('/change-pin');
  }
  /* eslint-enable @next/next/no-location-assign-relative-destination */
};

type StructureKind = 'sites' | 'teams' | 'disciplines';

/** The plant configuration lists, by their URL segment under /config. */
export type ConfigKind =
  | 'plant-types'
  | 'plant-categories'
  | 'plant-companies'
  | 'custom-fields'
  | 'meter-types'
  | 'document-types';

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
    'PlantSettings',
    'PlantImport',
    'User',
    'Seat',
    'Role',
    'Site',
    'Area',
    'Team',
    'Discipline',
    'Audit',
    'Poc',
    'Config',
    'Plant',
    'Document',
    'Template',
    'Reception',
    'Meter',
    'Schedule',
    'Check',
    'Defect',
    'Notification',
    'Work',
    'TemplateImport',
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

    // ------------------------------------------------ plant configuration
    // One set of endpoints serves every list under /config; lib/config.ts
    // gives each list its own response type.
    configList: build.query<
      unknown[],
      { kind: ConfigKind; includeArchived?: boolean }
    >({
      query: ({ kind, includeArchived }) => ({
        url: `/config/${kind}`,
        params: includeArchived ? { includeArchived: 'true' } : undefined,
      }),
      providesTags: (_result, _error, { kind }) => [
        { type: 'Config', id: kind },
      ],
    }),
    createConfig: build.mutation<
      { name?: string; label?: string },
      { kind: ConfigKind; body: object }
    >({
      query: ({ kind, body }) => ({
        url: `/config/${kind}`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { kind }) => [
        { type: 'Config', id: kind },
      ],
    }),
    updateConfig: build.mutation<
      unknown,
      { kind: ConfigKind; id: string; body: object }
    >({
      query: ({ kind, id, body }) => ({
        url: `/config/${kind}/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { kind }) => [
        { type: 'Config', id: kind },
      ],
    }),
    setConfigArchived: build.mutation<
      unknown,
      { kind: ConfigKind; id: string; archived: boolean }
    >({
      query: ({ kind, id, archived }) => ({
        url: `/config/${kind}/${id}/${archived ? 'archive' : 'restore'}`,
        method: 'POST',
      }),
      // Archiving a document type can change what plant types require.
      invalidatesTags: (_result, _error, { kind }) => [
        { type: 'Config', id: kind },
        { type: 'Config', id: 'plant-types' },
      ],
    }),
    setRequiredDocuments: build.mutation<
      PlantType,
      { plantTypeId: string } & SetRequiredDocumentsInput
    >({
      query: ({ plantTypeId, ...body }) => ({
        url: `/config/plant-types/${plantTypeId}/required-documents`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: [{ type: 'Config', id: 'plant-types' }],
    }),

    // -------------------------------------------------------------- plant
    plants: build.query<Paginated<PlantSummary>, ListPlantsQuery>({
      query: (params) => ({
        url: '/plants',
        params: cleanParams({ ...params }),
      }),
      providesTags: ['Plant'],
    }),
    plant: build.query<PlantDetail, string>({
      query: (id) => ({ url: `/plants/${id}` }),
      providesTags: (_result, _error, id) => [{ type: 'Plant', id }],
    }),
    plantHistory: build.query<
      Paginated<AuditEvent>,
      { id: string } & ListAuditQuery
    >({
      query: ({ id, ...params }) => ({
        url: `/plants/${id}/history`,
        params: cleanParams({ ...params }),
      }),
      providesTags: (_result, _error, { id }) => [{ type: 'Plant', id }],
    }),
    plantDuplicates: build.query<PlantDuplicates, PlantDuplicatesQuery>({
      query: (params) => ({
        url: '/plants/duplicates',
        params: cleanParams({ ...params }),
      }),
    }),
    resolvePlantQr: build.query<{ id: string }, string>({
      query: (token) => ({ url: `/plants/qr/${encodeURIComponent(token)}` }),
    }),
    createPlant: build.mutation<PlantSaved, CreatePlantInput>({
      query: (body) => ({ url: '/plants', method: 'POST', body }),
      invalidatesTags: ['Plant'],
    }),
    updatePlant: build.mutation<PlantSaved, { id: string } & UpdatePlantInput>({
      query: ({ id, ...body }) => ({
        url: `/plants/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Plant'],
    }),
    restrictPlant: build.mutation<
      PlantDetail,
      { id: string } & RestrictPlantInput
    >({
      query: ({ id, ...body }) => ({
        url: `/plants/${id}/restrict`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Plant', 'Schedule', 'Check', 'Work', 'Audit'],
    }),
    returnPlantToService: build.mutation<
      PlantDetail,
      { id: string } & ReturnToServiceInput
    >({
      query: ({ id, ...body }) => ({
        url: `/plants/${id}/return-to-service`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Plant', 'Schedule', 'Check', 'Work', 'Audit'],
    }),
    setPlantArchived: build.mutation<
      PlantDetail,
      { id: string; archived: boolean }
    >({
      query: ({ id, archived }) => ({
        url: `/plants/${id}/${archived ? 'archive' : 'restore'}`,
        method: 'POST',
      }),
      invalidatesTags: ['Plant', 'Schedule', 'Check', 'Work', 'Audit'],
    }),

    // ---------------------------------------------------------- documents
    // A document change can restrict plant, so plant data is refreshed too.
    plantDocuments: build.query<PlantDocuments, string>({
      query: (plantId) => ({ url: `/plants/${plantId}/documents` }),
      providesTags: ['Document'],
    }),
    documentsRegister: build.query<
      Paginated<DocumentRegisterRow>,
      ListDocumentsQuery
    >({
      query: (params) => ({
        url: '/documents',
        params: cleanParams({ ...params }),
      }),
      providesTags: ['Document'],
    }),
    plantSettings: build.query<PlantSettings, void>({
      query: () => ({ url: '/config/plant-settings' }),
      providesTags: ['PlantSettings'],
    }),
    savePlantSettings: build.mutation<PlantSettings, PlantSettings>({
      query: (body) => ({
        url: '/config/plant-settings',
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['PlantSettings'],
    }),
    plantImports: build.query<PlantImportSummary[], void>({
      query: () => ({ url: '/plant-imports' }),
      providesTags: ['PlantImport'],
    }),
    plantImport: build.query<PlantImportDetail, string>({
      query: (id) => ({ url: `/plant-imports/${id}` }),
      providesTags: ['PlantImport'],
    }),
    uploadPlantImport: build.mutation<PlantImportDetail, FormData>({
      query: (form) => ({ url: '/plant-imports', method: 'POST', body: form }),
      invalidatesTags: ['PlantImport'],
    }),
    updatePlantImportRow: build.mutation<
      PlantImportDetail,
      { importId: string; rowId: string } & UpdateImportRowInput
    >({
      query: ({ importId, rowId, ...body }) => ({
        url: `/plant-imports/${importId}/rows/${rowId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['PlantImport'],
    }),
    commitPlantImport: build.mutation<PlantImportDetail, string>({
      query: (id) => ({ url: `/plant-imports/${id}/commit`, method: 'POST' }),
      invalidatesTags: ['PlantImport', 'Plant'],
    }),
    uploadDocument: build.mutation<
      PlantDocument,
      { plantId: string; form: FormData }
    >({
      query: ({ plantId, form }) => ({
        url: `/plants/${plantId}/documents`,
        method: 'POST',
        body: form,
      }),
      invalidatesTags: ['Document', 'Plant'],
    }),
    replaceDocument: build.mutation<
      PlantDocument,
      { documentId: string; form: FormData }
    >({
      query: ({ documentId, form }) => ({
        url: `/documents/${documentId}/versions`,
        method: 'POST',
        body: form,
      }),
      invalidatesTags: ['Document', 'Plant'],
    }),
    documentAction: build.mutation<
      PlantDocument,
      {
        documentId: string;
        action: 'verify' | 'reject' | 'archive' | 'restore';
        reason?: string;
      }
    >({
      query: ({ documentId, action, reason }) => ({
        url: `/documents/${documentId}/${action}`,
        method: 'POST',
        body: action === 'reject' ? { reason } : undefined,
      }),
      invalidatesTags: ['Document', 'Plant'],
    }),

    // ---------------------------------------------------------- templates
    templates: build.query<
      CheckTemplateSummary[],
      { purpose?: TemplatePurpose; includeArchived?: boolean } | void
    >({
      query: (args) => ({
        url: '/templates',
        params: cleanParams({
          purpose: args?.purpose,
          includeArchived: args?.includeArchived ? 'true' : undefined,
        }),
      }),
      providesTags: ['Template'],
    }),
    template: build.query<CheckTemplateDetail, string>({
      query: (id) => ({ url: `/templates/${id}` }),
      providesTags: ['Template'],
    }),
    createTemplate: build.mutation<CheckTemplateDetail, CreateTemplateInput>({
      query: (body) => ({ url: '/templates', method: 'POST', body }),
      invalidatesTags: ['Template'],
    }),
    saveTemplateDraft: build.mutation<
      CheckTemplateDetail,
      { id: string } & SaveTemplateDraftInput
    >({
      query: ({ id, ...body }) => ({
        url: `/templates/${id}/draft`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['Template'],
    }),
    templateAction: build.mutation<
      CheckTemplateDetail,
      {
        id: string;
        action: 'publish' | 'archive' | 'restore';
        applyToUnstarted?: boolean;
      }
    >({
      query: ({ id, action, applyToUnstarted }) => ({
        url: `/templates/${id}/${action}`,
        method: 'POST',
        body: action === 'publish' ? { applyToUnstarted } : undefined,
      }),
      invalidatesTags: ['Template', 'Check'],
    }),
    duplicateTemplate: build.mutation<
      CheckTemplateDetail,
      { id: string; name: string }
    >({
      query: ({ id, name }) => ({
        url: `/templates/${id}/duplicate`,
        method: 'POST',
        body: { name },
      }),
      invalidatesTags: ['Template'],
    }),

    // ---------------------------------------------- check template import
    templateImports: build.query<TemplateImportSummary[], void>({
      query: () => ({ url: '/template-imports' }),
      providesTags: ['TemplateImport'],
    }),
    templateImport: build.query<TemplateImportDetail, string>({
      query: (id) => ({ url: `/template-imports/${id}` }),
      providesTags: ['TemplateImport'],
    }),
    uploadTemplateImport: build.mutation<TemplateImportDetail, FormData>({
      query: (body) => ({ url: '/template-imports', method: 'POST', body }),
      invalidatesTags: ['TemplateImport'],
    }),
    updateTemplateImportRow: build.mutation<
      TemplateImportDetail,
      { importId: string; rowId: string; data: Record<string, string> }
    >({
      query: ({ importId, rowId, data }) => ({
        url: `/template-imports/${importId}/rows/${rowId}`,
        method: 'PATCH',
        body: { data },
      }),
      invalidatesTags: ['TemplateImport'],
    }),
    commitTemplateImport: build.mutation<TemplateImportDetail, string>({
      query: (id) => ({ url: `/template-imports/${id}/commit`, method: 'POST' }),
      invalidatesTags: ['TemplateImport', 'Template'],
    }),

    // ---------------------------------------------------------- schedules
    schedules: build.query<
      CheckSchedule[],
      { plantId?: string; templateId?: string; includeArchived?: boolean } | void
    >({
      query: (args) => ({
        url: '/schedules',
        params: cleanParams({
          plantId: args?.plantId,
          templateId: args?.templateId,
          includeArchived: args?.includeArchived ? 'true' : undefined,
        }),
      }),
      providesTags: ['Schedule'],
    }),
    createSchedule: build.mutation<CheckSchedule[], CreateScheduleInput>({
      query: (body) => ({ url: '/schedules', method: 'POST', body }),
      invalidatesTags: ['Schedule', 'Check', 'Work'],
    }),
    updateSchedule: build.mutation<
      CheckSchedule,
      { id: string } & UpdateScheduleInput
    >({
      query: ({ id, ...body }) => ({
        url: `/schedules/${id}`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['Schedule', 'Check', 'Work'],
    }),
    scheduleAction: build.mutation<
      CheckSchedule,
      { id: string; action: 'pause' | 'resume' | 'end'; reason?: string }
    >({
      query: ({ id, action, reason }) => ({
        url: `/schedules/${id}/${action}`,
        method: 'POST',
        body: action === 'pause' ? { reason } : {},
      }),
      invalidatesTags: ['Schedule', 'Check', 'Work'],
    }),

    // -------------------------------------------------------------- checks
    dashboard: build.query<DashboardSummary, void>({
      query: () => ({ url: '/dashboard' }),
      providesTags: ['Work', 'Check', 'Defect', 'Plant', 'Document'],
    }),
    workSummary: build.query<WorkSummary, void>({
      query: () => ({ url: '/work/summary' }),
      providesTags: ['Work'],
    }),
    checks: build.query<Paginated<CheckSummary>, ListChecksQuery>({
      query: (params) => ({
        url: '/checks',
        params: cleanParams({ ...params }),
      }),
      providesTags: ['Check'],
    }),
    check: build.query<CheckDetail, string>({
      query: (id) => ({ url: `/checks/${id}` }),
      providesTags: ['Check'],
    }),
    createCheck: build.mutation<CheckDetail, CreateCheckInput>({
      query: (body) => ({ url: '/checks', method: 'POST', body }),
      invalidatesTags: ['Check', 'Work'],
    }),
    saveCheckAnswers: build.mutation<
      CheckDetail,
      { id: string } & SaveCheckAnswersInput
    >({
      query: ({ id, ...body }) => ({
        url: `/checks/${id}/answers`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['Check', 'Work', 'Defect', 'Plant'],
    }),
    addCheckEvidence: build.mutation<
      CheckDetail,
      { id: string; questionId: string; form: FormData }
    >({
      query: ({ id, questionId, form }) => ({
        url: `/checks/${id}/questions/${encodeURIComponent(questionId)}/evidence`,
        method: 'POST',
        body: form,
      }),
      invalidatesTags: ['Check'],
    }),
    removeCheckEvidence: build.mutation<
      CheckDetail,
      { id: string; evidenceId: string }
    >({
      query: ({ id, evidenceId }) => ({
        url: `/checks/${id}/evidence/${evidenceId}/remove`,
        method: 'POST',
      }),
      invalidatesTags: ['Check'],
    }),
    submitCheck: build.mutation<CheckDetail, string>({
      query: (id) => ({ url: `/checks/${id}/submit`, method: 'POST' }),
      // Submission can raise Defects, restrict plant and record meters.
      invalidatesTags: [
        'Check',
        'Work',
        'Defect',
        'Plant',
        'Meter',
        'Schedule',
        'Audit',
        'Notification',
      ],
    }),
    reviewCheck: build.mutation<
      CheckDetail,
      { id: string } & ReviewCheckInput
    >({
      query: ({ id, ...body }) => ({
        url: `/checks/${id}/review`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Check', 'Work', 'Defect', 'Plant', 'Meter', 'Audit'],
    }),
    checkReasonAction: build.mutation<
      CheckDetail,
      { id: string; action: 'reopen' | 'cancel'; reason: string }
    >({
      query: ({ id, action, reason }) => ({
        url: `/checks/${id}/${action}`,
        method: 'POST',
        body: { reason },
      }),
      invalidatesTags: ['Check', 'Work', 'Schedule', 'Defect'],
    }),
    assignCheck: build.mutation<
      CheckDetail,
      { id: string } & AssignCheckInput
    >({
      query: ({ id, ...body }) => ({
        url: `/checks/${id}/assign`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Check', 'Work'],
    }),
    rescheduleCheck: build.mutation<
      CheckDetail,
      { id: string; dueOn: string; reason?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `/checks/${id}/reschedule`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Check', 'Work', 'Schedule'],
    }),

    // ------------------------------------------------------------- defects
    defects: build.query<
      Paginated<DefectSummary>,
      Omit<ListDefectsQuery, 'assignedToMe'> & { assignedToMe?: boolean }
    >({
      query: (params) => ({
        url: '/defects',
        params: cleanParams({
          ...params,
          assignedToMe: params.assignedToMe ? 'true' : undefined,
        }),
      }),
      providesTags: ['Defect'],
    }),
    defect: build.query<DefectDetail, string>({
      query: (id) => ({ url: `/defects/${id}` }),
      providesTags: ['Defect'],
    }),
    assignDefect: build.mutation<
      DefectDetail,
      { id: string } & AssignDefectInput
    >({
      query: ({ id, ...body }) => ({
        url: `/defects/${id}/assign`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Defect', 'Work'],
    }),
    defectAction: build.mutation<
      DefectDetail,
      {
        id: string;
        action: 'start' | 'work' | 'verification' | 'close' | 'reopen';
        body?: object;
      }
    >({
      query: ({ id, action, body }) => ({
        url: `/defects/${id}/${action}`,
        method: 'POST',
        body: body ?? {},
      }),
      invalidatesTags: ['Defect', 'Check', 'Work', 'Plant', 'Audit'],
    }),
    recordDefectWork: build.mutation<
      DefectDetail,
      { id: string } & RecordDefectWorkInput
    >({
      query: ({ id, ...body }) => ({
        url: `/defects/${id}/work`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Defect'],
    }),
    addDefectEvidence: build.mutation<
      DefectDetail,
      { id: string; form: FormData }
    >({
      query: ({ id, form }) => ({
        url: `/defects/${id}/evidence`,
        method: 'POST',
        body: form,
      }),
      invalidatesTags: ['Defect'],
    }),
    removeDefectEvidence: build.mutation<
      DefectDetail,
      { id: string; evidenceId: string }
    >({
      query: ({ id, evidenceId }) => ({
        url: `/defects/${id}/evidence/${evidenceId}/remove`,
        method: 'POST',
      }),
      invalidatesTags: ['Defect'],
    }),

    // ------------------------------------------------------- notifications
    notifications: build.query<NotificationList, void>({
      query: () => ({ url: '/notifications' }),
      providesTags: ['Notification'],
    }),
    markNotificationsRead: build.mutation<
      NotificationList,
      { ids: string[] | 'all' }
    >({
      query: (body) => ({ url: '/notifications/read', method: 'POST', body }),
      invalidatesTags: ['Notification'],
    }),

    // ---------------------------------------------------------- reception
    // Reception changes the plant's status, so plant data is refreshed too.
    plantReception: build.query<PlantReception, string>({
      query: (plantId) => ({ url: `/plants/${plantId}/reception` }),
      providesTags: ['Reception'],
    }),
    assignReception: build.mutation<
      PlantReception,
      { plantId: string; templateId: string }
    >({
      query: ({ plantId, templateId }) => ({
        url: `/plants/${plantId}/reception`,
        method: 'POST',
        body: { templateId },
      }),
      invalidatesTags: ['Reception', 'Plant'],
    }),
    saveReceptionAnswers: build.mutation<
      ReceptionCheck,
      { checkId: string } & SaveReceptionAnswersInput
    >({
      query: ({ checkId, ...body }) => ({
        url: `/receptions/${checkId}/answers`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['Reception'],
    }),
    addReceptionPhoto: build.mutation<
      ReceptionCheck,
      { checkId: string; questionId: string; form: FormData }
    >({
      query: ({ checkId, questionId, form }) => ({
        url: `/receptions/${checkId}/questions/${encodeURIComponent(questionId)}/evidence`,
        method: 'POST',
        body: form,
      }),
      invalidatesTags: ['Reception'],
    }),
    removeReceptionPhoto: build.mutation<
      ReceptionCheck,
      { checkId: string; evidenceId: string }
    >({
      query: ({ checkId, evidenceId }) => ({
        url: `/receptions/${checkId}/evidence/${evidenceId}/remove`,
        method: 'POST',
      }),
      invalidatesTags: ['Reception'],
    }),
    receptionAction: build.mutation<
      PlantReception,
      {
        checkId: string;
        action: 'submit' | 'approve' | 'return' | 'cancel';
        comment?: string;
      }
    >({
      query: ({ checkId, action, comment }) => ({
        url: `/receptions/${checkId}/${action}`,
        method: 'POST',
        body: action === 'return' ? { comment } : undefined,
      }),
      invalidatesTags: ['Reception', 'Plant', 'Audit', 'Meter', 'Defect'],
    }),

    // ------------------------------------------------------- meter readings
    plantMeters: build.query<PlantMeters, string>({
      query: (plantId) => ({ url: `/plants/${plantId}/meters` }),
      providesTags: ['Meter'],
    }),
    recordMeterReading: build.mutation<
      PlantMeters,
      { plantId: string } & CreateMeterReadingInput
    >({
      query: ({ plantId, ...body }) => ({
        url: `/plants/${plantId}/meters`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Meter', 'Plant'],
    }),
    correctMeterReading: build.mutation<
      PlantMeters,
      { id: string } & CorrectMeterReadingInput
    >({
      query: ({ id, ...body }) => ({
        url: `/meter-readings/${id}/correct`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Meter', 'Plant'],
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
  useConfigListQuery,
  useCreateConfigMutation,
  useUpdateConfigMutation,
  useSetConfigArchivedMutation,
  useSetRequiredDocumentsMutation,
  usePlantsQuery,
  usePlantQuery,
  usePlantHistoryQuery,
  useLazyPlantDuplicatesQuery,
  useResolvePlantQrQuery,
  useCreatePlantMutation,
  useUpdatePlantMutation,
  useRestrictPlantMutation,
  useReturnPlantToServiceMutation,
  useSetPlantArchivedMutation,
  usePlantDocumentsQuery,
  useDocumentsRegisterQuery,
  useUploadDocumentMutation,
  useReplaceDocumentMutation,
  useDocumentActionMutation,
  useTemplatesQuery,
  useTemplateQuery,
  useLazyTemplateQuery,
  useCreateTemplateMutation,
  useSaveTemplateDraftMutation,
  useTemplateActionMutation,
  useDuplicateTemplateMutation,
  useTemplateImportsQuery,
  useTemplateImportQuery,
  useUploadTemplateImportMutation,
  useUpdateTemplateImportRowMutation,
  useCommitTemplateImportMutation,
  useSchedulesQuery,
  useCreateScheduleMutation,
  useUpdateScheduleMutation,
  useScheduleActionMutation,
  useWorkSummaryQuery,
  useDashboardQuery,
  useChecksQuery,
  useCheckQuery,
  useCreateCheckMutation,
  useSaveCheckAnswersMutation,
  useAddCheckEvidenceMutation,
  useRemoveCheckEvidenceMutation,
  useSubmitCheckMutation,
  useReviewCheckMutation,
  useCheckReasonActionMutation,
  useAssignCheckMutation,
  useRescheduleCheckMutation,
  useDefectsQuery,
  useDefectQuery,
  useAssignDefectMutation,
  useDefectActionMutation,
  useRecordDefectWorkMutation,
  useAddDefectEvidenceMutation,
  useRemoveDefectEvidenceMutation,
  useNotificationsQuery,
  useMarkNotificationsReadMutation,
  usePlantReceptionQuery,
  useAssignReceptionMutation,
  useSaveReceptionAnswersMutation,
  useAddReceptionPhotoMutation,
  useRemoveReceptionPhotoMutation,
  useReceptionActionMutation,
  usePlantSettingsQuery,
  useSavePlantSettingsMutation,
  usePlantImportsQuery,
  usePlantImportQuery,
  useUploadPlantImportMutation,
  useUpdatePlantImportRowMutation,
  useCommitPlantImportMutation,
  usePlantMetersQuery,
  useRecordMeterReadingMutation,
  useCorrectMeterReadingMutation,
  useAuditEventsQuery,
  usePocChecksQuery,
  useCreatePocCheckMutation,
} = api;
