import type { Middleware } from '@reduxjs/toolkit';
import { type ApiError, ERROR_CODES, type ErrorCode } from '@corecheck/shared';
import { notifyError, notifySuccess } from './feedback';
import { SESSION_ENDING_CODES } from './http';

/**
 * What to say when a mutation succeeds: a fixed message, or one built from
 * the request and the server's reply. Returning null says nothing.
 */
export type SuccessMessage =
  | string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | ((arg: any, result: any) => string | null);

/** Errors the app answers by moving the user on, not by a toast. */
const REDIRECTING: readonly ErrorCode[] = [
  ...SESSION_ENDING_CODES,
  ERROR_CODES.PIN_CHANGE_REQUIRED,
  ERROR_CODES.MFA_REQUIRED,
  ERROR_CODES.MFA_SETUP_REQUIRED,
  ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
];

interface MutationMeta {
  arg?: { type?: string; endpointName?: string; originalArgs?: unknown };
  requestStatus?: string;
  rejectedWithValue?: boolean;
}

/**
 * A toast for every action, as on CoreStock: each finished mutation shows
 * its success message, and each failed one shows the server's reason. Field
 * errors still appear beside their inputs; the toast points to them.
 */
export const actionToasts =
  (messages: Record<string, SuccessMessage>): Middleware =>
  () =>
  (next) =>
  (action) => {
    const result = next(action);
    const { meta, payload } = action as {
      meta?: MutationMeta;
      payload?: unknown;
    };
    if (meta?.arg?.type !== 'mutation' || !meta.arg.endpointName) return result;

    if (meta.requestStatus === 'fulfilled') {
      const message = messages[meta.arg.endpointName];
      const text =
        typeof message === 'function'
          ? message(meta.arg.originalArgs, payload)
          : message;
      if (text) notifySuccess(text);
    } else if (meta.requestStatus === 'rejected' && meta.rejectedWithValue) {
      const error = payload as ApiError | undefined;
      if (!error || REDIRECTING.includes(error.code)) return result;
      notifyError(
        error.fieldErrors?.length
          ? { ...error, message: 'Please correct the highlighted fields.' }
          : error,
      );
    }
    return result;
  };
