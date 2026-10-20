import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  ERROR_CODES,
  type PermissionCode,
  type StaffRole,
} from '@corecheck/shared';
import { forbidden, unauthenticated } from '../common/errors.js';
import { StaffSessionsService } from '../platform/staff-sessions.service.js';
import { CUSTOMER_COOKIE, readSessionToken, STAFF_COOKIE } from './cookies.js';
import { CustomerSessionsService } from './customer-sessions.service.js';
import { META } from './decorators.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Authenticates every route that is not @Public: customer routes by the
 * customer session, @StaffArea routes by the staff session. Then applies the
 * route's rules — permissions, pending PIN or password changes, MFA and the
 * read-only state of an expired organisation. Server-side checks are
 * authoritative; the apps only hide what users cannot do (NAV-004, SEC-001).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly customerSessions: CustomerSessionsService,
    private readonly staffSessions: StaffSessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const meta = <T>(key: string): T | undefined =>
      this.reflector.getAllAndOverride<T>(key, [
        context.getHandler(),
        context.getClass(),
      ]);

    if (meta<boolean>(META.public)) return true;
    const req = context.switchToHttp().getRequest<Request>();

    if (meta<boolean>(META.staffArea)) {
      await this.authenticateStaff(req, meta);
      return true;
    }

    const token = readSessionToken(req, CUSTOMER_COOKIE);
    if (!token) throw unauthenticated();
    const auth = await this.customerSessions.authenticate(token);
    req.auth = auth;

    if (auth.mustChangePin && !meta<boolean>(META.allowPendingPinChange)) {
      throw forbidden(
        'Choose a new PIN before continuing.',
        ERROR_CODES.PIN_CHANGE_REQUIRED,
      );
    }
    if (
      auth.org.readOnly &&
      MUTATING_METHODS.has(req.method) &&
      !meta<boolean>(META.allowReadOnlyOrg)
    ) {
      throw forbidden(
        "Your organisation's CoreCheck account has expired. You can view and export information, but not make changes.",
        ERROR_CODES.ORG_READ_ONLY,
      );
    }
    const required = meta<PermissionCode[]>(META.permissions) ?? [];
    if (!required.every((permission) => auth.permissions.has(permission))) {
      throw forbidden();
    }
    return true;
  }

  private async authenticateStaff(
    req: Request,
    meta: <T>(key: string) => T | undefined,
  ): Promise<void> {
    const token = readSessionToken(req, STAFF_COOKIE);
    if (!token) throw unauthenticated();
    const staff = await this.staffSessions.authenticate(token);
    req.staff = staff;

    if (!staff.mfaVerified && !meta<boolean>(META.allowPendingMfa)) {
      throw forbidden(
        staff.mfaEnabled
          ? 'Enter your authenticator code to continue.'
          : 'Set up two-factor authentication to continue.',
        staff.mfaEnabled
          ? ERROR_CODES.MFA_REQUIRED
          : ERROR_CODES.MFA_SETUP_REQUIRED,
      );
    }
    if (
      staff.mustChangePassword &&
      !meta<boolean>(META.allowPendingPasswordChange)
    ) {
      throw forbidden(
        'Choose a new password before continuing.',
        ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
      );
    }
    const roles = meta<StaffRole[]>(META.staffRoles);
    if (roles && !roles.includes(staff.staffRole)) throw forbidden();
  }
}
