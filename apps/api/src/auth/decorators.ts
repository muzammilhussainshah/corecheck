import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PermissionCode, StaffRole } from '@corecheck/shared';
import type { CustomerAuth, StaffAuth } from './auth-context.js';

export const META = {
  public: 'cc:public',
  staffArea: 'cc:staff-area',
  permissions: 'cc:permissions',
  allowPendingPinChange: 'cc:allow-pending-pin-change',
  allowReadOnlyOrg: 'cc:allow-read-only-org',
  skipTenantTransaction: 'cc:skip-tenant-transaction',
  allowPendingMfa: 'cc:allow-pending-mfa',
  allowPendingPasswordChange: 'cc:allow-pending-password-change',
  staffRoles: 'cc:staff-roles',
} as const;

/** No sign-in needed (health check, sign-in itself). */
export const Public = () => SetMetadata(META.public, true);

/** Every route in the controller belongs to the internal staff portal. */
export const StaffArea = () => SetMetadata(META.staffArea, true);

/** The signed-in user must hold every listed permission (ROL-AC-01). */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(META.permissions, permissions);

/** Usable while the user still has to replace a temporary PIN (USR-AC-02). */
export const AllowPendingPinChange = () =>
  SetMetadata(META.allowPendingPinChange, true);

/** A change that is still allowed once the organisation has expired. */
export const AllowReadOnlyOrg = () => SetMetadata(META.allowReadOnlyOrg, true);

/**
 * The handler manages its own database work through SystemDb, for example so
 * that a failed PIN attempt is recorded even though the request fails.
 */
export const SkipTenantTransaction = () =>
  SetMetadata(META.skipTenantTransaction, true);

/** Staff route usable before the second factor is completed. */
export const AllowPendingMfa = () => SetMetadata(META.allowPendingMfa, true);

/** Staff route usable before a temporary password is replaced. */
export const AllowPendingPasswordChange = () =>
  SetMetadata(META.allowPendingPasswordChange, true);

/** Staff route limited to these internal ranks. */
export const RequireStaffRoles = (...roles: StaffRole[]) =>
  SetMetadata(META.staffRoles, roles);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CustomerAuth => {
    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (!auth)
      throw new Error('CurrentAuth used on a route without customer sign-in.');
    return auth;
  },
);

export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StaffAuth => {
    const staff = context.switchToHttp().getRequest<Request>().staff;
    if (!staff)
      throw new Error('CurrentStaff used on a route without staff sign-in.');
    return staff;
  },
);
