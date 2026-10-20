'use client';

import type { MeResponse, PermissionCode } from '@corecheck/shared';
import { useMeQuery } from './api';

/**
 * The signed-in user and what they may do. The API is authoritative; this
 * only decides what the interface offers (NAV-004).
 */
export const useSession = () => {
  const { data: me, isLoading, error } = useMeQuery();
  const can = (...permissions: PermissionCode[]) =>
    !!me &&
    permissions.every((permission) => me.permissions.includes(permission));
  const canAny = (...permissions: PermissionCode[]) =>
    !!me &&
    permissions.some((permission) => me.permissions.includes(permission));
  return { me, isLoading, error, can, canAny };
};

export type Session = ReturnType<typeof useSession> & { me: MeResponse };
