import { HttpException, HttpStatus } from '@nestjs/common';
import {
  ERROR_CODES,
  type ErrorCode,
  type FieldError,
} from '@corecheck/shared';

/** An expected failure with a code the client can act on. */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly extras: {
      fieldErrors?: FieldError[];
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message, status);
  }
}

export const validationFailed = (fieldErrors: FieldError[]) =>
  new AppException(
    HttpStatus.BAD_REQUEST,
    ERROR_CODES.VALIDATION_FAILED,
    'Some details need correcting.',
    { fieldErrors },
  );

export const fieldError = (field: string, message: string) =>
  validationFailed([{ field, message }]);

export const notFound = (what: string) =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ERROR_CODES.NOT_FOUND,
    `${what} not found.`,
  );

export const forbidden = (
  message = 'You do not have permission to do that.',
  code: ErrorCode = ERROR_CODES.FORBIDDEN,
) => new AppException(HttpStatus.FORBIDDEN, code, message);

export const outOfScope = (
  message = 'That is outside the sites you are assigned to.',
) => new AppException(HttpStatus.FORBIDDEN, ERROR_CODES.OUT_OF_SCOPE, message);

export const conflict = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
) => new AppException(HttpStatus.CONFLICT, code, message, { details });

export const unauthenticated = (
  code: ErrorCode = ERROR_CODES.UNAUTHENTICATED,
  message = 'Please sign in.',
) => new AppException(HttpStatus.UNAUTHORIZED, code, message);
