import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import axios, { type AxiosError, type AxiosInstance, type Method } from 'axios';
import { type ApiError, ERROR_CODES, type ErrorCode } from '@corecheck/shared';

/**
 * HTTP access to the API. Browsers call /api/* on their own origin, which the
 * Next.js rewrite forwards to the API, so the httpOnly session cookie travels
 * with every request and no token is ever visible to page scripts.
 */
export const createHttpClient = (): AxiosInstance =>
  axios.create({
    baseURL: '/api',
    headers: { 'Content-Type': 'application/json' },
    timeout: 45_000,
  });

const NETWORK_ERROR: ApiError = {
  statusCode: 0,
  code: ERROR_CODES.INTERNAL_ERROR,
  message: 'Could not reach CoreCheck. Check your connection and try again.',
};

/** The API is asleep or restarting: the proxy times out or has no upstream. */
const STARTING_UP: ApiError = {
  statusCode: 503,
  code: ERROR_CODES.SERVICE_UNAVAILABLE,
  message:
    'CoreCheck is starting up. This can take up to a minute — please try again shortly.',
};

/** Any thrown value as the API's error shape. */
export const toApiError = (error: unknown): ApiError => {
  const axiosError = error as AxiosError<ApiError>;
  const body = axiosError?.response?.data;
  if (body && typeof body === 'object' && 'code' in body) return body;
  if (axiosError?.code === 'ECONNABORTED') return STARTING_UP;
  if ([502, 503, 504].includes(axiosError?.response?.status ?? 0)) {
    return STARTING_UP;
  }
  if (axiosError?.response) {
    return {
      statusCode: axiosError.response.status,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Something went wrong. Please try again.',
    };
  }
  return NETWORK_ERROR;
};

export const isApiError = (value: unknown): value is ApiError =>
  !!value &&
  typeof value === 'object' &&
  'code' in value &&
  'statusCode' in value;

export interface QueryArgs {
  url: string;
  method?: Method;
  body?: unknown;
  params?: Record<string, unknown>;
}

/**
 * Codes that mean "this session is over": the app sends the user back to the
 * sign-in page, telling them why.
 */
export const SESSION_ENDING_CODES: readonly ErrorCode[] = [
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.SESSION_EXPIRED,
  ERROR_CODES.SESSION_REPLACED,
  ERROR_CODES.SESSION_REVOKED,
  ERROR_CODES.ACCOUNT_LOCKED,
  ERROR_CODES.ACCOUNT_INACTIVE,
  ERROR_CODES.ORG_SUSPENDED,
  ERROR_CODES.ORG_ARCHIVED,
];

/**
 * RTK Query base query over axios. `onError` sees every failure first so the
 * app can redirect on an ended session or a pending PIN/MFA step.
 */
export const axiosBaseQuery =
  (
    http: AxiosInstance,
    onError?: (error: ApiError) => void,
  ): BaseQueryFn<QueryArgs, unknown, ApiError> =>
  async ({ url, method = 'GET', body, params }) => {
    // A file upload: with the client's JSON default axios would turn the
    // form into JSON. Naming it multipart lets the browser add the boundary.
    const headers =
      typeof FormData !== 'undefined' && body instanceof FormData
        ? { 'Content-Type': 'multipart/form-data' }
        : undefined;
    try {
      const response = await http.request({
        url,
        method,
        data: body,
        params,
        headers,
      });
      return { data: response.data };
    } catch (error) {
      const apiError = toApiError(error);
      onError?.(apiError);
      return { error: apiError };
    }
  };

/** Drops empty values so they do not appear in the query string. */
export const cleanParams = (
  params: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    ),
  );
