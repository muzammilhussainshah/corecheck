import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { type ApiError, ERROR_CODES, type ErrorCode } from '@corecheck/shared';
import { AppException } from './errors.js';

/** Friendly messages for unique indexes a user can collide with. */
const UNIQUE_MESSAGES: Record<string, string> = {
  organisations_name_key: 'An organisation with this name already exists.',
  roles_org_name_key: 'A role with this name already exists.',
  sites_org_name_key: 'A site with this name already exists.',
  site_areas_site_name_key:
    'An area with this name already exists on this site.',
  teams_org_name_key: 'A team with this name already exists.',
  disciplines_org_name_key: 'A discipline with this name already exists.',
  platform_staff_email_key: 'A staff member with this email already exists.',
};

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ERROR_CODES.VALIDATION_FAILED,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
};

/** Socket and DNS failures: the database is out of reach, not broken. */
const UNREACHABLE = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

const networkCode = (exception: unknown): string | undefined => {
  const error = exception as {
    code?: unknown;
    driverError?: { code?: unknown };
    errors?: Array<{ code?: unknown }>;
  };
  // pg reports these on the error itself, inside a TypeORM wrapper, or (for
  // several addresses tried at once) inside an AggregateError.
  const code = [
    error?.code,
    error?.driverError?.code,
    error?.errors?.[0]?.code,
  ].find((value): value is string => typeof value === 'string');
  return code && UNREACHABLE.has(code) ? code : undefined;
};

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
}

/**
 * Turns every failure into the ApiError shape. Unexpected errors are logged
 * with the request id and reach the client only as a generic message: no stack
 * traces, SQL or identifiers leave the server (VAL-008).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const body = this.toApiError(exception, request);
    body.requestId = request.requestId;
    response.status(body.statusCode).json(body);
  }

  private toApiError(exception: unknown, request: Request): ApiError {
    if (exception instanceof AppException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        ...exception.extras,
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many attempts. Please wait a minute and try again.',
      };
    }

    if (exception instanceof QueryFailedError) {
      const mapped = this.fromDatabaseError(exception.driverError as PgError);
      if (mapped) return mapped;
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      if (statusCode < 500) {
        return {
          statusCode,
          code: STATUS_CODES[statusCode] ?? ERROR_CODES.VALIDATION_FAILED,
          message:
            statusCode === HttpStatus.NOT_FOUND
              ? 'Not found.'
              : statusCode === HttpStatus.PAYLOAD_TOO_LARGE
                ? 'That file or request is too large.'
                : 'The request could not be processed.',
        };
      }
    }

    const unreachable = networkCode(exception);
    if (unreachable) {
      this.logger.warn(
        `Database unreachable (${unreachable}) on ${request.method} ${request.path} [${request.requestId}]`,
      );
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message:
          'CoreCheck cannot reach its database right now. Please try again in a moment.',
      };
    }

    this.logger.error(
      `Unhandled error on ${request.method} ${request.path} [${request.requestId}]`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Something went wrong on our side. Please try again.',
    };
  }

  private fromDatabaseError(error: PgError): ApiError | null {
    switch (error.code) {
      case '23505': {
        const message = error.constraint && UNIQUE_MESSAGES[error.constraint];
        return {
          statusCode: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message: message ?? 'That already exists.',
        };
      }
      case 'CC001':
        return {
          statusCode: HttpStatus.CONFLICT,
          code: ERROR_CODES.SEAT_LIMIT_REACHED,
          message:
            'All licensed seats are in use. Contact CoreCheck to add seats, or deactivate a user first.',
        };
      case '42501':
        // Row-level security or a missing grant refused the statement. The API
        // checks access first, so reaching this means a bug or a probe: log it.
        this.logger.warn(`Database refused access: ${error.detail ?? ''}`);
        return {
          statusCode: HttpStatus.FORBIDDEN,
          code: ERROR_CODES.FORBIDDEN,
          message: 'You do not have permission to do that.',
        };
      default:
        return null;
    }
  }
}
