import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import {
  type createStaffSchema,
  ERROR_CODES,
  type StaffMember,
  type StaffWithPassword,
  type updateStaffSchema,
} from '@corecheck/shared';
import {
  AuditService,
  clientMetadata,
  staffActor,
} from '../audit/audit.service.js';
import type { StaffAuth } from '../auth/auth-context.js';
import { generateTemporaryPassword, SecretHasher } from '../common/crypto.js';
import { conflict, forbidden, notFound } from '../common/errors.js';
import type { ClientInfo } from '../common/request.js';
import { PlatformStaffEntity } from '../database/entities.js';
import { PlatformDb } from '../database/db-context.js';
import { StaffSessionsService } from './staff-sessions.service.js';

type CreateBody = z.output<typeof createStaffSchema>;
type UpdateBody = z.output<typeof updateStaffSchema>;

export const toStaffMember = (staff: PlatformStaffEntity): StaffMember => ({
  id: staff.id,
  name: staff.name,
  email: staff.email,
  staffRole: staff.staffRole,
  status: staff.status,
  locked: staff.lockedAt !== null,
  mfaEnabled: staff.mfaEnabledAt !== null,
  lastLoginAt: staff.lastLoginAt?.toISOString() ?? null,
  createdAt: staff.createdAt.toISOString(),
});

/** CoreCheck staff accounts, managed by owners. */
@Injectable()
export class StaffService {
  constructor(
    private readonly platformDb: PlatformDb,
    private readonly sessions: StaffSessionsService,
    private readonly hasher: SecretHasher,
    private readonly audit: AuditService,
  ) {}

  list(auth: StaffAuth): Promise<StaffMember[]> {
    return this.platformDb.transaction(auth.staffId, async (manager) => {
      const staff = await manager.find(PlatformStaffEntity, {
        order: { name: 'ASC' },
      });
      return staff.map(toStaffMember);
    });
  }

  create(
    auth: StaffAuth,
    input: CreateBody,
    info: ClientInfo,
  ): Promise<StaffWithPassword> {
    return this.platformDb.transaction(auth.staffId, async (manager) => {
      const temporaryPassword = generateTemporaryPassword();
      const result = await manager.insert(PlatformStaffEntity, {
        email: input.email,
        name: input.name,
        staffRole: input.staffRole,
        passwordHash: await this.hasher.hash(temporaryPassword),
        mustChangePassword: true,
        status: 'active',
        failedLoginAttempts: 0,
      });
      const staff = await manager.findOneByOrFail(PlatformStaffEntity, {
        id: (result.identifiers[0] as { id: string }).id,
      });
      await this.record(
        manager,
        auth,
        info,
        'staff.created',
        staff,
        `Created staff member ${staff.name} (${staff.staffRole})`,
      );
      return { staff: toStaffMember(staff), temporaryPassword };
    });
  }

  update(
    auth: StaffAuth,
    id: string,
    input: UpdateBody,
    info: ClientInfo,
  ): Promise<StaffMember> {
    return this.platformDb.transaction(auth.staffId, async (manager) => {
      const staff = await this.lock(manager, id);
      if (
        input.staffRole &&
        input.staffRole !== 'owner' &&
        staff.staffRole === 'owner'
      ) {
        await this.assertAnotherOwner(manager, staff.id);
      }
      const before = { name: staff.name, staffRole: staff.staffRole };
      await manager.update(
        PlatformStaffEntity,
        { id },
        {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.staffRole === undefined
            ? {}
            : { staffRole: input.staffRole }),
        },
      );
      const updated = await manager.findOneByOrFail(PlatformStaffEntity, {
        id,
      });
      await this.record(
        manager,
        auth,
        info,
        'staff.updated',
        updated,
        `Updated staff member ${updated.name}`,
        {
          before,
          after: { name: updated.name, staffRole: updated.staffRole },
        },
      );
      return toStaffMember(updated);
    });
  }

  setActive(
    auth: StaffAuth,
    id: string,
    active: boolean,
    info: ClientInfo,
  ): Promise<StaffMember> {
    return this.platformDb.transaction(auth.staffId, async (manager) => {
      if (id === auth.staffId && !active) {
        throw forbidden(
          'You cannot disable your own account.',
          ERROR_CODES.SELF_ACTION,
        );
      }
      const staff = await this.lock(manager, id);
      if (!active && staff.staffRole === 'owner')
        await this.assertAnotherOwner(manager, staff.id);

      await manager.update(
        PlatformStaffEntity,
        { id },
        { status: active ? 'active' : 'disabled' },
      );
      if (!active)
        await this.sessions.revokeAllForStaff(manager, id, 'disabled');
      const updated = await manager.findOneByOrFail(PlatformStaffEntity, {
        id,
      });
      await this.record(
        manager,
        auth,
        info,
        'staff.updated',
        updated,
        `${active ? 'Enabled' : 'Disabled'} staff member ${updated.name}`,
        { before: { status: staff.status }, after: { status: updated.status } },
      );
      return toStaffMember(updated);
    });
  }

  /**
   * Issues a temporary password and clears any lockout. With resetMfa the
   * authenticator enrolment is removed too, for a lost phone.
   */
  resetCredentials(
    auth: StaffAuth,
    id: string,
    resetMfa: boolean,
    info: ClientInfo,
  ): Promise<StaffWithPassword> {
    return this.platformDb.transaction(auth.staffId, async (manager) => {
      if (id === auth.staffId) {
        throw forbidden(
          'Use "Change password" for your own account.',
          ERROR_CODES.SELF_ACTION,
        );
      }
      await this.lock(manager, id);
      const temporaryPassword = generateTemporaryPassword();
      await manager.update(
        PlatformStaffEntity,
        { id },
        {
          passwordHash: await this.hasher.hash(temporaryPassword),
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedAt: null,
          ...(resetMfa
            ? {
                mfaSecretEncrypted: null,
                mfaPendingSecretEncrypted: null,
                mfaEnabledAt: null,
              }
            : {}),
        },
      );
      await this.sessions.revokeAllForStaff(manager, id, 'password_reset');
      const updated = await manager.findOneByOrFail(PlatformStaffEntity, {
        id,
      });
      await this.record(
        manager,
        auth,
        info,
        'staff.password.reset',
        updated,
        `Reset the password${resetMfa ? ' and two-factor set-up' : ''} of ${updated.name}`,
      );
      return { staff: toStaffMember(updated), temporaryPassword };
    });
  }

  private async lock(
    manager: EntityManager,
    id: string,
  ): Promise<PlatformStaffEntity> {
    const staff = await manager.findOne(PlatformStaffEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!staff) throw notFound('Staff member');
    return staff;
  }

  /** Refuses to leave the platform without an active owner. */
  private async assertAnotherOwner(
    manager: EntityManager,
    excludingId: string,
  ): Promise<void> {
    const [{ count }] = (await manager.query(
      `select count(*)::int as count from corecheck.platform_staff
        where staff_role = 'owner' and status = 'active' and id <> $1`,
      [excludingId],
    )) as [{ count: number }];
    if (count === 0) {
      throw conflict(
        ERROR_CODES.LAST_OWNER,
        'There must always be at least one active owner.',
      );
    }
  }

  private record(
    manager: EntityManager,
    auth: StaffAuth,
    info: ClientInfo,
    action: 'staff.created' | 'staff.updated' | 'staff.password.reset',
    target: PlatformStaffEntity,
    summary: string,
    change: {
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    } = {},
  ): Promise<void> {
    return this.audit.record(manager, {
      scope: 'platform',
      orgId: null,
      actor: staffActor(auth),
      action,
      entityType: 'staff',
      entityId: target.id,
      summary,
      ...change,
      metadata: clientMetadata(info),
    });
  }
}
